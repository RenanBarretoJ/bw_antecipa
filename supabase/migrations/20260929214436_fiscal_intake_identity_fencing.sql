-- One fiscal identity across channels. No schedules or integrations are enabled.
BEGIN;

CREATE TABLE private.fiscal_identity_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL CHECK (document_type IN ('NFE', 'NFSE')),
  identity_sha256 text NOT NULL CHECK (identity_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('RESERVED','REQUIRES_REVIEW','COMPLETED','CLEANUP_PENDING','RELEASED')),
  owner_token uuid NOT NULL DEFAULT gen_random_uuid(),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  lease_expires_at timestamptz NOT NULL,
  source_channel text NOT NULL CHECK (source_channel IN ('MANUAL_UPLOAD','EMAIL_INTAKE')),
  actor_type text NOT NULL CHECK (actor_type IN ('HUMAN','SYSTEM')),
  actor_user_id uuid REFERENCES auth.users(id),
  actor_session_id uuid,
  ingest_actor jsonb NOT NULL CHECK (jsonb_typeof(ingest_actor)='object'),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id),
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id),
  cedente_fundo_id uuid NOT NULL REFERENCES public.cedente_fundos(id),
  estabelecimento_id uuid NOT NULL REFERENCES public.cedente_estabelecimentos(id),
  integration_id uuid REFERENCES private.email_integrations(id),
  message_id uuid REFERENCES private.email_intake_messages(id),
  attachment_id uuid REFERENCES private.email_intake_attachments(id),
  attachment_token uuid,
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[a-f0-9]{64}$'),
  nota_fiscal_id uuid REFERENCES public.notas_fiscais(id) ON DELETE SET NULL,
  recovery_nf_id uuid REFERENCES public.notas_fiscais(id) ON DELETE SET NULL,
  recovery_snapshot jsonb,
  review_intent_id uuid REFERENCES public.nfse_review_intents(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type, identity_sha256),
  CHECK ((actor_type='HUMAN' AND actor_user_id IS NOT NULL AND actor_session_id IS NOT NULL)
    OR (actor_type='SYSTEM' AND source_channel='EMAIL_INTAKE' AND actor_user_id IS NULL AND actor_session_id IS NULL)),
  CHECK ((source_channel='MANUAL_UPLOAD' AND integration_id IS NULL AND message_id IS NULL AND attachment_id IS NULL AND attachment_token IS NULL)
    OR (source_channel='EMAIL_INTAKE' AND integration_id IS NOT NULL AND message_id IS NOT NULL AND attachment_id IS NOT NULL AND attachment_token IS NOT NULL))
);
CREATE INDEX fiscal_reservation_expiry ON private.fiscal_identity_reservations(lease_expires_at, id)
  WHERE state IN ('RESERVED','CLEANUP_PENDING');
CREATE INDEX fiscal_reservation_review ON private.fiscal_identity_reservations(fundo_id, cedente_id, created_at)
  WHERE state = 'REQUIRES_REVIEW';
CREATE INDEX fiscal_reservation_attachment ON private.fiscal_identity_reservations(attachment_id) WHERE attachment_id IS NOT NULL;
CREATE INDEX fiscal_reservation_nf ON private.fiscal_identity_reservations(nota_fiscal_id) WHERE nota_fiscal_id IS NOT NULL;

-- A write intent is durable BEFORE a Storage request. An uncertain request is
-- never treated as an absent object. Paths are unique to a reservation generation.
CREATE TABLE private.fiscal_storage_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES private.fiscal_identity_reservations(id),
  generation bigint NOT NULL,
  owner_token uuid NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('notas-fiscais','documentos-v2')),
  path text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'PLANNED' CHECK (state IN ('PLANNED','STORED','RETAINED','DELETE_PENDING','DELETED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at timestamptz NOT NULL DEFAULT now(),
  cleanup_token uuid,
  cleanup_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bucket, path),
  CHECK (path LIKE reservation_id::text || '/' || generation::text || '/%'),
  CHECK ((cleanup_token IS NULL) = (cleanup_expires_at IS NULL))
);
CREATE INDEX fiscal_storage_cleanup ON private.fiscal_storage_intents(retry_at, id)
  WHERE state = 'DELETE_PENDING';
CREATE INDEX fiscal_storage_reservation ON private.fiscal_storage_intents(reservation_id, generation);
ALTER TABLE private.fiscal_identity_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.fiscal_storage_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.fiscal_identity_reservations, private.fiscal_storage_intents FROM PUBLIC, anon, authenticated, service_role;

-- SECURITY DEFINER is limited to these domain entry points: browser roles have
-- no direct table privileges. SYSTEM is a domain actor, never an Auth user.
CREATE FUNCTION private.fiscal_validate_email_claim(p_actor jsonb,p_fundo_id uuid,p_cedente_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_integration private.email_integrations%ROWTYPE;
BEGIN
  SELECT i.* INTO v_integration FROM private.email_integrations i
    JOIN private.email_intake_messages m ON m.integration_id=i.id
    JOIN private.email_intake_attachments a ON a.message_id=m.id
    WHERE i.id=(p_actor->>'integrationId')::uuid AND i.fundo_id=p_fundo_id AND i.enabled
      AND m.id=(p_actor->>'messageId')::uuid AND m.received_at>=i.start_at
      AND a.id=(p_actor->>'attachmentId')::uuid AND a.status='PROCESSING'
      AND a.lease_token=(p_actor->>'attachmentToken')::uuid AND a.lease_expires_at>clock_timestamp()
      AND a.kind='FILE' AND NOT a.inline AND a.size_bytes BETWEEN 1 AND 20971520
    FOR UPDATE OF a;
  IF v_integration.id IS NULL THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST' USING ERRCODE='42501'; END IF;
  IF v_integration.routing_mode='ALLOWLIST' AND NOT EXISTS (
    SELECT 1 FROM private.email_integration_cedentes c WHERE c.integration_id=v_integration.id AND c.cedente_id=p_cedente_id AND c.active
  ) THEN RAISE EXCEPTION 'FISCAL_ROUTING_DENIED' USING ERRCODE='42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_validate_email_claim(jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.fiscal_validate_actor(
  p_actor jsonb, p_fundo_id uuid, p_cedente_fundo_id uuid, p_estabelecimento_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cf public.cedente_fundos%ROWTYPE;
BEGIN
  SELECT * INTO v_cf FROM public.cedente_fundos WHERE id = p_cedente_fundo_id;
  IF v_cf.id IS NULL OR v_cf.fundo_id IS DISTINCT FROM p_fundo_id
    OR v_cf.status <> 'ativo' OR v_cf.vigente_desde > clock_timestamp()
    OR (v_cf.vigente_ate IS NOT NULL AND v_cf.vigente_ate <= clock_timestamp())
    OR NOT private.estabelecimento_pode_originar(p_estabelecimento_id, v_cf.cedente_id, p_fundo_id)
    THEN RAISE EXCEPTION 'FISCAL_SCOPE_DENIED' USING ERRCODE = '42501'; END IF;
  IF p_actor->>'type' = 'HUMAN' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM (p_actor->>'userId')::uuid
      OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.status::text = 'ativo')
      OR NOT public.usuario_possui_mfa_elevado()
      OR NOT EXISTS (SELECT 1 FROM public.obter_sessao_mfa_atual() s WHERE s.status = 'valid')
      OR NOT coalesce((
        (public.get_user_role() IN ('cedente','consultor') AND private.usuario_pode_operar_cedente(v_cf.cedente_id)
          AND (public.get_user_role() <> 'consultor' OR private.consultor_tem_acesso_fundo(p_fundo_id)))
        OR (public.get_user_role() = 'gestor' AND private.gestor_tem_acesso_cedente(v_cf.cedente_id)
          AND private.gestor_tem_acesso_fundo_operacional(p_fundo_id))
      ), false) THEN RAISE EXCEPTION 'FISCAL_ACTOR_DENIED' USING ERRCODE = '42501'; END IF;
  ELSIF p_actor->>'type' = 'SYSTEM' AND p_actor->>'source' = 'EMAIL_INTAKE' THEN
    IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor ? 'userId'
      THEN RAISE EXCEPTION 'FISCAL_ACTOR_DENIED' USING ERRCODE = '42501'; END IF;
    PERFORM private.fiscal_validate_email_claim(p_actor,p_fundo_id,v_cf.cedente_id);
  ELSE RAISE EXCEPTION 'FISCAL_ACTOR_DENIED' USING ERRCODE = '42501'; END IF;
  RETURN v_cf.cedente_id;
END;
$$;

CREATE FUNCTION public.fiscal_intake_reserve(
  p_actor jsonb, p_fundo_id uuid, p_cedente_fundo_id uuid, p_estabelecimento_id uuid,
  p_document_type text, p_fiscal_key text, p_file_sha256 text, p_recover_xml boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cedente uuid; v_hash text; v_row private.fiscal_identity_reservations%ROWTYPE; v_nf uuid; v_snapshot jsonb;
BEGIN
  IF p_document_type IS NULL OR p_fiscal_key IS NULL OR p_file_sha256 IS NULL
    OR p_document_type NOT IN ('NFE','NFSE') OR p_file_sha256 !~ '^[a-f0-9]{64}$'
    OR (p_document_type = 'NFE' AND p_fiscal_key !~ '^[0-9]{44}$')
    OR (p_document_type = 'NFSE' AND p_fiscal_key !~ '^[0-9]{50}$')
    THEN RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID'; END IF;
  v_hash := encode(extensions.digest(p_fiscal_key, 'sha256'), 'hex');
  -- All channels serialize on the same canonical identity, independent of fund,
  -- mailbox, filename and parser strategy. The global NF key remains unique.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_document_type || ':' || v_hash, 0));
  v_cedente := private.fiscal_validate_actor(p_actor, p_fundo_id, p_cedente_fundo_id, p_estabelecimento_id);
  IF p_document_type = 'NFE' AND NOT EXISTS (SELECT 1 FROM public.cedente_estabelecimentos e
    WHERE e.id = p_estabelecimento_id AND e.cnpj = substring(p_fiscal_key FROM 7 FOR 14))
    THEN RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID'; END IF;
  SELECT id INTO v_nf FROM public.notas_fiscais WHERE chave_acesso = p_fiscal_key;
  IF v_nf IS NOT NULL THEN
    PERFORM 1 FROM public.notas_fiscais WHERE id=v_nf FOR UPDATE;
    IF NOT coalesce(p_recover_xml,false) OR p_document_type<>'NFE'
      OR NOT private.fiscal_can_recover_xml(v_nf,v_cedente,p_cedente_fundo_id,p_fundo_id)
      THEN RETURN jsonb_build_object('status','DUPLICATE'); END IF;
    SELECT to_jsonb(n) INTO v_snapshot FROM public.notas_fiscais n WHERE id=v_nf;
  END IF;
  SELECT * INTO v_row FROM private.fiscal_identity_reservations
    WHERE document_type = p_document_type AND identity_sha256 = v_hash FOR UPDATE;
  IF v_row.id IS NOT NULL AND v_row.state <> 'RELEASED' THEN
    IF v_row.state = 'RESERVED' AND v_row.lease_expires_at <= clock_timestamp() THEN
      IF EXISTS (SELECT 1 FROM private.fiscal_storage_intents WHERE reservation_id = v_row.id AND generation=v_row.generation AND state <> 'DELETED') THEN
        UPDATE private.fiscal_identity_reservations SET state = 'CLEANUP_PENDING', updated_at = clock_timestamp() WHERE id = v_row.id;
        UPDATE private.fiscal_storage_intents SET state = 'DELETE_PENDING', retry_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE reservation_id = v_row.id AND generation=v_row.generation AND state NOT IN ('DELETED','RETAINED');
        RETURN jsonb_build_object('status','CLEANUP_PENDING');
      END IF;
      -- A generation without Storage intent or fiscal writes is safe to reclaim.
    ELSE RETURN jsonb_build_object('status', CASE WHEN v_row.state = 'COMPLETED' THEN 'DUPLICATE'
      WHEN v_row.state = 'CLEANUP_PENDING' THEN 'CLEANUP_PENDING' ELSE 'IN_PROGRESS' END); END IF;
  END IF;
  INSERT INTO private.fiscal_identity_reservations(document_type, identity_sha256, state, lease_expires_at,
    source_channel, actor_type, actor_user_id, actor_session_id, ingest_actor, fundo_id, cedente_id, cedente_fundo_id, estabelecimento_id,
    integration_id, message_id, attachment_id, attachment_token, file_sha256,recovery_nf_id,recovery_snapshot)
  VALUES (p_document_type, v_hash, 'RESERVED', clock_timestamp() + interval '5 minutes',
    CASE WHEN p_actor->>'type' = 'HUMAN' THEN 'MANUAL_UPLOAD' ELSE 'EMAIL_INTAKE' END,
    p_actor->>'type', (p_actor->>'userId')::uuid,
    CASE WHEN p_actor->>'type' = 'HUMAN' THEN (auth.jwt()->>'session_id')::uuid ELSE NULL END,
    jsonb_strip_nulls(jsonb_build_object('type',p_actor->>'type','userId',p_actor->>'userId','source',p_actor->>'source',
      'integrationId',p_actor->>'integrationId','messageId',p_actor->>'messageId','attachmentId',p_actor->>'attachmentId')),
    p_fundo_id, v_cedente, p_cedente_fundo_id, p_estabelecimento_id,
    (p_actor->>'integrationId')::uuid, (p_actor->>'messageId')::uuid, (p_actor->>'attachmentId')::uuid,
    (p_actor->>'attachmentToken')::uuid, p_file_sha256,v_nf,v_snapshot)
  ON CONFLICT (document_type, identity_sha256) DO UPDATE SET
    state = 'RESERVED', owner_token = gen_random_uuid(), generation = private.fiscal_identity_reservations.generation + 1,
    lease_expires_at = EXCLUDED.lease_expires_at, source_channel = EXCLUDED.source_channel,
    actor_type = EXCLUDED.actor_type, actor_user_id = EXCLUDED.actor_user_id, actor_session_id = EXCLUDED.actor_session_id,
    ingest_actor = EXCLUDED.ingest_actor, fundo_id = EXCLUDED.fundo_id,
    cedente_id = EXCLUDED.cedente_id, cedente_fundo_id = EXCLUDED.cedente_fundo_id, estabelecimento_id = EXCLUDED.estabelecimento_id,
    integration_id = EXCLUDED.integration_id, message_id = EXCLUDED.message_id, attachment_id = EXCLUDED.attachment_id,
    attachment_token = EXCLUDED.attachment_token, file_sha256 = EXCLUDED.file_sha256,
    nota_fiscal_id = NULL, review_intent_id = NULL,recovery_nf_id=EXCLUDED.recovery_nf_id,recovery_snapshot=EXCLUDED.recovery_snapshot, updated_at = clock_timestamp()
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('status','RESERVED','id',v_row.id,'token',v_row.owner_token,'generation',v_row.generation);
END;
$$;

-- Lock and revalidate on EVERY transactional mutation, not a prior HTTP check.
CREATE FUNCTION private.fiscal_assert_owner(p_id uuid, p_token uuid, p_generation bigint)
RETURNS private.fiscal_identity_reservations LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row private.fiscal_identity_reservations%ROWTYPE; v_actor jsonb;
BEGIN
  SELECT * INTO v_row FROM private.fiscal_identity_reservations WHERE id = p_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_row.document_type || ':' || v_row.identity_sha256, 0));
  SELECT * INTO v_row FROM private.fiscal_identity_reservations WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.owner_token IS DISTINCT FROM p_token OR v_row.generation IS DISTINCT FROM p_generation
    OR v_row.state <> 'RESERVED' OR v_row.lease_expires_at <= clock_timestamp()
    THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST' USING ERRCODE = '42501'; END IF;
  v_actor := CASE WHEN v_row.actor_type = 'HUMAN' THEN jsonb_build_object('type','HUMAN','userId',v_row.actor_user_id)
    ELSE jsonb_build_object('type','SYSTEM','source','EMAIL_INTAKE','integrationId',v_row.integration_id,
      'messageId',v_row.message_id,'attachmentId',v_row.attachment_id,'attachmentToken',v_row.attachment_token) END;
  PERFORM private.fiscal_validate_actor(v_actor, v_row.fundo_id, v_row.cedente_fundo_id, v_row.estabelecimento_id);
  IF v_row.source_channel='EMAIL_INTAKE' AND v_row.actor_type='HUMAN' THEN
    PERFORM private.fiscal_validate_email_claim(jsonb_build_object('integrationId',v_row.integration_id,'messageId',v_row.message_id,
      'attachmentId',v_row.attachment_id,'attachmentToken',v_row.attachment_token),v_row.fundo_id,v_row.cedente_id);
  END IF;
  RETURN v_row;
END;
$$;

CREATE FUNCTION public.fiscal_intake_plan_storage(p_id uuid, p_token uuid, p_generation bigint, p_bucket text, p_extension text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row private.fiscal_identity_reservations%ROWTYPE; v_path text; v_intent uuid;
BEGIN
  v_row := private.fiscal_assert_owner(p_id, p_token, p_generation);
  IF p_extension IS NULL OR p_extension NOT IN ('pdf','xml') OR p_bucket IS NULL
    OR p_bucket NOT IN ('notas-fiscais','documentos-v2') THEN RAISE EXCEPTION 'FISCAL_STORAGE_INVALID'; END IF;
  v_path := p_id::text || '/' || p_generation::text || '/' || gen_random_uuid()::text || '.' || p_extension;
  INSERT INTO private.fiscal_storage_intents(reservation_id, generation, owner_token, bucket, path, sha256)
    VALUES(p_id, p_generation, p_token, p_bucket, v_path, v_row.file_sha256) RETURNING id INTO v_intent;
  RETURN jsonb_build_object('id',v_intent,'bucket',p_bucket,'path',v_path);
END;
$$;

CREATE FUNCTION public.fiscal_intake_fail(p_id uuid, p_token uuid, p_generation bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row private.fiscal_identity_reservations%ROWTYPE; v_state text;
BEGIN
  v_row := private.fiscal_assert_owner(p_id, p_token, p_generation);
  IF v_row.nota_fiscal_id IS NOT NULL THEN RAISE EXCEPTION 'FISCAL_PERSISTED_RECONCILIATION_REQUIRED'; END IF;
  UPDATE private.fiscal_storage_intents SET state = 'DELETE_PENDING', updated_at = clock_timestamp()
    WHERE reservation_id = p_id AND generation = p_generation AND state <> 'DELETED';
  v_state := CASE WHEN EXISTS (SELECT 1 FROM private.fiscal_storage_intents WHERE reservation_id = p_id AND generation=p_generation AND state <> 'DELETED')
    THEN 'CLEANUP_PENDING' ELSE 'RELEASED' END;
  UPDATE private.fiscal_identity_reservations SET state = v_state, updated_at = clock_timestamp() WHERE id = p_id;
  RETURN v_state;
END;
$$;

CREATE FUNCTION public.fiscal_intake_resolve_scope(p_actor jsonb,p_fundo_id uuid,p_issuer_cnpj text,p_cedente_fundo_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row record; v_matriz uuid; v_count integer;
BEGIN
  IF p_actor->>'type'='HUMAN' THEN
    SELECT e.id INTO v_matriz FROM public.cedente_fundos cf JOIN public.cedente_estabelecimentos e ON e.cedente_id=cf.cedente_id AND e.tipo='matriz'
      WHERE cf.id=p_cedente_fundo_id AND cf.fundo_id=p_fundo_id;
    IF v_matriz IS NULL THEN RETURN jsonb_build_object('status','ROUTING_DENIED'); END IF;
    PERFORM private.fiscal_validate_actor(p_actor,p_fundo_id,p_cedente_fundo_id,v_matriz);
  ELSIF p_actor->>'type'='SYSTEM' AND p_actor->>'source'='EMAIL_INTAKE' AND auth.role()='service_role' THEN
    IF NOT EXISTS (SELECT 1 FROM private.email_integrations i JOIN private.email_intake_messages m ON m.integration_id=i.id
      JOIN private.email_intake_attachments a ON a.message_id=m.id
      WHERE i.id=(p_actor->>'integrationId')::uuid AND i.fundo_id=p_fundo_id AND i.enabled
        AND m.id=(p_actor->>'messageId')::uuid AND a.id=(p_actor->>'attachmentId')::uuid
        AND a.status='PROCESSING' AND a.lease_token=(p_actor->>'attachmentToken')::uuid AND a.lease_expires_at>clock_timestamp())
      THEN RETURN jsonb_build_object('status','ROUTING_DENIED'); END IF;
  ELSE RETURN jsonb_build_object('status','ROUTING_DENIED'); END IF;
  SELECT count(*) INTO v_count FROM public.cedente_estabelecimentos e JOIN public.cedente_fundos cf ON cf.cedente_id=e.cedente_id
    WHERE e.cnpj=p_issuer_cnpj AND cf.fundo_id=p_fundo_id AND cf.status='ativo'
      AND (p_cedente_fundo_id IS NULL OR cf.id=p_cedente_fundo_id)
      AND private.estabelecimento_pode_originar(e.id,e.cedente_id,p_fundo_id);
  IF v_count=0 THEN RETURN jsonb_build_object('status','UNKNOWN_CEDENTE'); END IF;
  IF v_count>1 THEN RETURN jsonb_build_object('status','AMBIGUOUS'); END IF;
  SELECT e.id,e.cedente_id,e.cnpj,e.razao_social,cf.id AS cedente_fundo_id INTO v_row
    FROM public.cedente_estabelecimentos e JOIN public.cedente_fundos cf ON cf.cedente_id=e.cedente_id
    WHERE e.cnpj=p_issuer_cnpj AND cf.fundo_id=p_fundo_id AND cf.status='ativo'
      AND (p_cedente_fundo_id IS NULL OR cf.id=p_cedente_fundo_id)
      AND private.estabelecimento_pode_originar(e.id,e.cedente_id,p_fundo_id);
  PERFORM private.fiscal_validate_actor(p_actor,p_fundo_id,v_row.cedente_fundo_id,v_row.id);
  RETURN jsonb_build_object('fundoId',p_fundo_id,'cedenteId',v_row.cedente_id,'cedenteFundoId',v_row.cedente_fundo_id,
    'estabelecimentoId',v_row.id,'cnpj',v_row.cnpj,'razaoSocial',v_row.razao_social);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('status','ROUTING_DENIED');
END;
$$;
REVOKE ALL ON FUNCTION public.fiscal_intake_resolve_scope(jsonb,uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_resolve_scope(jsonb,uuid,text,uuid) TO authenticated,service_role;

REVOKE ALL ON FUNCTION private.fiscal_validate_actor(jsonb,uuid,uuid,uuid),
  private.fiscal_assert_owner(uuid,uuid,bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fiscal_intake_reserve(jsonb,uuid,uuid,uuid,text,text,text,boolean),
  public.fiscal_intake_plan_storage(uuid,uuid,bigint,text,text), public.fiscal_intake_fail(uuid,uuid,bigint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_reserve(jsonb,uuid,uuid,uuid,text,text,text,boolean),
  public.fiscal_intake_plan_storage(uuid,uuid,bigint,text,text), public.fiscal_intake_fail(uuid,uuid,bigint)
  TO authenticated, service_role;
COMMIT;
