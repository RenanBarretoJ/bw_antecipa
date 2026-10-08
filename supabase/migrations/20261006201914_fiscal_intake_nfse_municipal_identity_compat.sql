-- R1.1: preserve HEALTH municipal identity inside the shared RLX fence.
-- Dependencies: HEALTH municipal constraint/index + RLX reserve/stage/assert.
-- No rows/history/ACL of existing entry points are rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $preconditions$
BEGIN
  IF to_regprocedure('public.fiscal_intake_reserve(jsonb,uuid,uuid,uuid,text,text,text,boolean)') IS NULL
    OR to_regprocedure('public.fiscal_intake_stage(uuid,uuid,bigint,jsonb,jsonb,text,text,bigint,text)') IS NULL
    OR to_regprocedure('private.fiscal_assert_nf(uuid,uuid,uuid,bigint)') IS NULL
    OR to_regclass('public.nfse_municipal_identity_unique') IS NULL THEN
    RAISE EXCEPTION 'FISCAL_MUNICIPAL_COMPAT_PRECONDITION';
  END IF;
END;
$preconditions$;

-- Pure identity validation. National material and hashes remain unchanged.
-- The municipal tuple is exactly nfseIdentity() / the HEALTH unique index.
CREATE FUNCTION private.fiscal_identity_material(p_type text, p_material text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v jsonb; v_cnpj text; v_authority text; v_number text; v_canonical text;
BEGIN
  IF p_type = 'NFE' AND p_material ~ '^[0-9]{44}$' THEN RETURN p_material; END IF;
  IF p_type = 'NFSE' AND p_material ~ '^[0-9]{50}$'
    AND p_material !~ '^([0-9])\1{49}$' THEN RETURN p_material; END IF;
  IF p_type IS DISTINCT FROM 'NFSE' OR p_material IS NULL OR length(p_material) > 512 THEN
    RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID' USING ERRCODE='22023';
  END IF;
  BEGIN v := p_material::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID' USING ERRCODE='22023';
  END;
  IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(v) <> 4 OR v->>0 IS DISTINCT FROM 'NFSE_MUNICIPAL'
    OR jsonb_typeof(v->1) IS DISTINCT FROM 'string'
    OR jsonb_typeof(v->2) IS DISTINCT FROM 'string'
    OR jsonb_typeof(v->3) IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID' USING ERRCODE='22023';
  END IF;
  v_cnpj := v->>1; v_authority := v->>2; v_number := v->>3;
  IF NOT (v_cnpj ~ '^[0-9]{14}$' AND private.cnpj_valido(v_cnpj)
    AND v_number ~ '^[1-9][0-9]{0,14}$'
    AND length(v_authority) BETWEEN 8 AND 200
    AND v_authority ~ '^(PREFEITURA|MUNICIPIO|SECRETARIA)'
    AND v_authority !~ '[^A-Z0-9 /().,''-]'
    AND v_authority = upper(btrim(regexp_replace(v_authority, '\s+', ' ', 'g')))) THEN
    RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID' USING ERRCODE='22023';
  END IF;
  -- jsonb::text inserts spaces. Serialize each string separately, like JSON.stringify.
  v_canonical := '["NFSE_MUNICIPAL",' || to_json(v_cnpj)::text || ','
    || to_json(v_authority)::text || ',' || to_json(v_number)::text || ']';
  IF p_material IS DISTINCT FROM v_canonical THEN
    RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID' USING ERRCODE='22023';
  END IF;
  RETURN v_canonical;
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_identity_material(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.fiscal_identity_from_values(p_values jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_type text := p_values->>'tipo_documento_fiscal'; v_provenance jsonb := p_values->'fiscal_proveniencia';
  v_material text;
BEGIN
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'FISCAL_FACTS_INVALID' USING ERRCODE='22023';
  END IF;
  IF v_type='NFSE' AND v_provenance->>'strategy'='nfse_municipal_visual' THEN
    IF p_values->>'chave_acesso' IS NOT NULL
      OR v_provenance->>'source' IS DISTINCT FROM 'PDF_VISUAL_FALLBACK'
      OR jsonb_typeof(v_provenance->'codigo_verificacao') IS DISTINCT FROM 'string'
      OR (v_provenance->>'codigo_verificacao' ~ '^[A-Za-z0-9][A-Za-z0-9./-]{3,79}$') IS NOT TRUE THEN
      RAISE EXCEPTION 'FISCAL_FACTS_INVALID' USING ERRCODE='22023';
    END IF;
    v_material := '["NFSE_MUNICIPAL",' || coalesce(to_json(p_values->>'cnpj_emitente')::text,'null') || ','
      || coalesce(to_json(v_provenance->>'orgao_emissor')::text,'null') || ','
      || coalesce(to_json(p_values->>'numero_nf')::text,'null') || ']';
  ELSE
    IF v_type='NFSE' AND (v_provenance->>'strategy' IN ('danfse_v2_labels','danfse_v2_visual')) IS NOT TRUE THEN
      RAISE EXCEPTION 'FISCAL_FACTS_INVALID' USING ERRCODE='22023';
    END IF;
    v_material := p_values->>'chave_acesso';
  END IF;
  RETURN private.fiscal_identity_material(v_type,v_material);
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_identity_from_values(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fiscal_intake_reserve(
  p_actor jsonb, p_fundo_id uuid, p_cedente_fundo_id uuid, p_estabelecimento_id uuid,
  p_document_type text, p_fiscal_key text, p_file_sha256 text, p_recover_xml boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cedente uuid; v_hash text; v_row private.fiscal_identity_reservations%ROWTYPE; v_nf uuid; v_snapshot jsonb; v_identity text; v_municipal jsonb;
BEGIN
  IF p_document_type IS NULL OR p_fiscal_key IS NULL OR p_file_sha256 IS NULL
    OR p_document_type NOT IN ('NFE','NFSE') OR p_file_sha256 !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID'; END IF;
  v_identity := private.fiscal_identity_material(p_document_type,p_fiscal_key);
  v_hash := encode(extensions.digest(v_identity, 'sha256'), 'hex');
  -- All channels serialize on the same canonical identity, independent of fund,
  -- mailbox, filename and parser strategy. The global NF key remains unique.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_document_type || ':' || v_hash, 0));
  v_cedente := private.fiscal_validate_actor(p_actor, p_fundo_id, p_cedente_fundo_id, p_estabelecimento_id);
  IF p_document_type = 'NFE' AND NOT EXISTS (SELECT 1 FROM public.cedente_estabelecimentos e
    WHERE e.id = p_estabelecimento_id AND e.cnpj = substring(p_fiscal_key FROM 7 FOR 14))
    THEN RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID'; END IF;
  IF left(v_identity,1)='[' THEN
    v_municipal := v_identity::jsonb;
    IF NOT EXISTS (SELECT 1 FROM public.cedente_estabelecimentos e
      WHERE e.id=p_estabelecimento_id AND e.cnpj=v_municipal->>1) THEN
      RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID' USING ERRCODE='22023';
    END IF;
    SELECT id INTO v_nf FROM public.notas_fiscais
      WHERE tipo_documento_fiscal='NFSE' AND fiscal_proveniencia->>'strategy'='nfse_municipal_visual'
        AND cnpj_emitente=v_municipal->>1 AND fiscal_proveniencia->>'orgao_emissor'=v_municipal->>2
        AND numero_nf=v_municipal->>3;
  ELSE
    SELECT id INTO v_nf FROM public.notas_fiscais WHERE chave_acesso = v_identity;
  END IF;
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

CREATE OR REPLACE FUNCTION public.fiscal_intake_stage(
  p_id uuid,p_token uuid,p_generation bigint,p_values jsonb,p_parcelas jsonb,
  p_file_name text,p_mime_type text,p_size_bytes bigint,p_document_code text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.fiscal_identity_reservations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FISCAL_ACTOR_DENIED' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=p_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.document_type||':'||r.identity_sha256,0));
  SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=p_id FOR UPDATE;
  IF r.owner_token IS DISTINCT FROM p_token OR r.generation IS DISTINCT FROM p_generation OR r.state<>'RESERVED'
    OR r.lease_expires_at<=clock_timestamp() OR NOT private.estabelecimento_pode_originar(r.estabelecimento_id,r.cedente_id,r.fundo_id)
    THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST' USING ERRCODE='42501'; END IF;
  PERFORM private.fiscal_validate_stored_actor(r);
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object'
    OR encode(extensions.digest(private.fiscal_identity_from_values(p_values),'sha256'),'hex') IS DISTINCT FROM r.identity_sha256
    OR p_values->>'tipo_documento_fiscal' IS DISTINCT FROM r.document_type
    OR NOT EXISTS (SELECT 1 FROM public.cedente_estabelecimentos e WHERE e.id=r.estabelecimento_id AND e.cnpj=p_values->>'cnpj_emitente')
    THEN RAISE EXCEPTION 'FISCAL_FACTS_INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM private.fiscal_prepared_imports s WHERE s.reservation_id=p_id AND s.generation=p_generation AND s.storage_intent_id IS NOT NULL) THEN
    IF EXISTS (SELECT 1 FROM private.fiscal_prepared_imports s WHERE s.reservation_id=p_id AND s.generation=p_generation
      AND s.owner_token=p_token AND s.values_json=p_values AND s.parcelas=p_parcelas AND s.size_bytes=p_size_bytes
      AND s.mime_type=p_mime_type AND s.document_code=p_document_code) THEN RETURN; END IF;
    RAISE EXCEPTION 'FISCAL_PREPARATION_IMMUTABLE';
  END IF;
  INSERT INTO private.fiscal_prepared_imports(reservation_id,generation,owner_token,values_json,parcelas,file_name,mime_type,size_bytes,document_code)
    VALUES(p_id,p_generation,p_token,p_values,p_parcelas,p_file_name,p_mime_type,p_size_bytes,p_document_code)
  ON CONFLICT (reservation_id) DO UPDATE SET generation=EXCLUDED.generation,owner_token=EXCLUDED.owner_token,
    values_json=EXCLUDED.values_json,parcelas=EXCLUDED.parcelas,file_name=EXCLUDED.file_name,mime_type=EXCLUDED.mime_type,
    size_bytes=EXCLUDED.size_bytes,document_code=EXCLUDED.document_code,politica_id=NULL,politica_versao_id=NULL,
    document_type_id=NULL,storage_intent_id=NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.fiscal_assert_nf(p_nf uuid,p_id uuid,p_token uuid,p_generation bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.fiscal_identity_reservations%ROWTYPE;
BEGIN
  r := private.fiscal_assert_owner(p_id,p_token,p_generation);
  IF NOT EXISTS (SELECT 1 FROM public.notas_fiscais nf WHERE nf.id=p_nf AND nf.fiscal_reservation_id=r.id
    AND nf.fundo_id=r.fundo_id AND nf.cedente_id=r.cedente_id AND nf.cedente_fundo_id=r.cedente_fundo_id
    AND nf.estabelecimento_id=r.estabelecimento_id AND nf.status::text='rascunho'
    AND nf.tipo_documento_fiscal=r.document_type
    AND encode(extensions.digest(private.fiscal_identity_from_values(to_jsonb(nf)),'sha256'),'hex')=r.identity_sha256)
    THEN RAISE EXCEPTION 'FISCAL_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
END;
$$;

COMMIT;
