-- Prospective NFE companions. Canonical NF/reservation facts remain immutable.
BEGIN;
ALTER TABLE private.email_intake_attachments ADD COLUMN document_code text CHECK(document_code IN('nf_xml','nf_danfe_pdf')),
 ADD COLUMN fiscal_identity_sha256 text CHECK(fiscal_identity_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE private.email_intake_attachments DROP CONSTRAINT email_intake_attachments_status_check;
ALTER TABLE private.email_intake_attachments ADD CONSTRAINT email_intake_attachments_status_check CHECK(status IN(
 'PENDING','PROCESSING','RETRY','IMPORTED','DUPLICATE','REQUIRES_REVIEW','QUARANTINED','REJECTED','IGNORED','FAILED','CLEANUP_PENDING','COMPANION_LINKED'));
CREATE TABLE private.fiscal_document_claims(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reservation_id uuid NOT NULL REFERENCES private.fiscal_identity_reservations(id),
 nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE CASCADE,
 document_code text NOT NULL CHECK(document_code IN('nf_xml','nf_danfe_pdf')),
 file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
 owner_token uuid NOT NULL DEFAULT gen_random_uuid(),generation bigint NOT NULL DEFAULT 1 CHECK(generation>0),
 state text NOT NULL DEFAULT 'RESERVED' CHECK(state IN('RESERVED','COMPLETED','CLEANUP_PENDING','RELEASED')),
 lease_expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
 actor jsonb NOT NULL CHECK(actor->>'type'='SYSTEM' AND actor->>'source'='EMAIL_INTAKE'),
 storage_intent_id uuid REFERENCES private.fiscal_storage_intents(id),document_id uuid REFERENCES public.documentos_repositorio(id),
 version_id uuid REFERENCES public.documento_versoes(id),requirement_id uuid REFERENCES public.documento_requisito_instancias(id),
 file_name text NOT NULL,mime_type text NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 20971520),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(reservation_id,document_code,file_sha256),UNIQUE(reservation_id,owner_token,generation)
);
CREATE INDEX fiscal_document_claim_expiry ON private.fiscal_document_claims(lease_expires_at,id) WHERE state='RESERVED';
CREATE INDEX fiscal_document_claim_nf ON private.fiscal_document_claims(nota_fiscal_id);
CREATE UNIQUE INDEX fiscal_document_claim_storage ON private.fiscal_document_claims(storage_intent_id) WHERE storage_intent_id IS NOT NULL;
ALTER TABLE private.fiscal_document_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.fiscal_document_claims FROM PUBLIC,anon,authenticated,service_role;

-- Delete compensation includes independently fenced companion generations.
CREATE FUNCTION private.fiscal_cleanup_deleted_nf_companions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE private.fiscal_storage_intents o SET state='DELETE_PENDING',retry_at=clock_timestamp(),updated_at=clock_timestamp()
  FROM private.fiscal_document_claims c WHERE c.nota_fiscal_id=OLD.id AND c.storage_intent_id=o.id AND o.state<>'DELETED';
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION private.fiscal_cleanup_deleted_nf_companions() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER fiscal_cleanup_deleted_nf_companions BEFORE DELETE ON public.notas_fiscais
 FOR EACH ROW WHEN(OLD.fiscal_reservation_id IS NOT NULL) EXECUTE FUNCTION private.fiscal_cleanup_deleted_nf_companions();

CREATE FUNCTION private.fiscal_assert_document_nf(p_nf uuid,p_id uuid,p_token uuid,p_generation bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.fiscal_document_claims; r private.fiscal_identity_reservations;
BEGIN
 SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=p_id;
 IF r.id IS NULL THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.document_type||':'||r.identity_sha256,0));
 -- NF before document claim: official draft deletion takes its NF lock first.
 PERFORM 1 FROM public.notas_fiscais WHERE id=p_nf FOR SHARE;
 SELECT * INTO c FROM private.fiscal_document_claims WHERE reservation_id=p_id AND owner_token=p_token AND generation=p_generation FOR UPDATE;
 IF c.id IS NULL THEN PERFORM private.fiscal_assert_nf(p_nf,p_id,p_token,p_generation); RETURN; END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' OR c.nota_fiscal_id IS DISTINCT FROM p_nf OR c.state<>'RESERVED' OR c.lease_expires_at<=clock_timestamp()
  OR r.state<>'COMPLETED' OR c.actor->>'integrationId' IS DISTINCT FROM r.integration_id::text
  OR NOT EXISTS(SELECT 1 FROM public.notas_fiscais n WHERE n.id=p_nf AND n.fiscal_reservation_id=r.id AND n.fundo_id=r.fundo_id AND n.cedente_id=r.cedente_id
    AND n.cedente_fundo_id=r.cedente_fundo_id AND n.estabelecimento_id=r.estabelecimento_id AND encode(extensions.digest(n.chave_acesso,'sha256'),'hex')=r.identity_sha256)
  THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST' USING ERRCODE='42501'; END IF;
 PERFORM private.fiscal_validate_actor(c.actor,r.fundo_id,r.cedente_fundo_id,r.estabelecimento_id);
END $$;
REVOKE ALL ON FUNCTION private.fiscal_assert_document_nf(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.email_complete_companion(p_actor jsonb,p_nf uuid,p_sha text,p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE private.email_intake_attachments SET status='COMPANION_LINKED',nota_fiscal_id=p_nf,sha256=p_sha,document_code=p_code,
  last_error_code=NULL,completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL
  WHERE id=(p_actor->>'attachmentId')::uuid AND status='PROCESSING' AND lease_token=(p_actor->>'attachmentToken')::uuid AND lease_expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.email_complete_companion(jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.email_document_pair_outcome(p_actor jsonb,p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_outcome NOT IN('AMBIGUOUS','WAITING_CANONICAL_XML') THEN RAISE EXCEPTION 'FISCAL_DOCUMENT_INVALID' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM private.email_intake_attachments WHERE id=(p_actor->>'attachmentId')::uuid AND status='PROCESSING'
   AND lease_token=(p_actor->>'attachmentToken')::uuid AND lease_expires_at>clock_timestamp() AND last_error_code IS DISTINCT FROM p_outcome) THEN
  INSERT INTO public.logs_auditoria(usuario_id,ator_tipo,origem,tipo_evento,entidade_tipo,entidade_id,dados_depois)
   VALUES(NULL,'sistema','fiscal_intake',CASE WHEN p_outcome='AMBIGUOUS' THEN 'PAIR_MISMATCH' ELSE 'WAITING_CANONICAL_XML' END,
    'email_attachment',(p_actor->>'attachmentId')::uuid,jsonb_build_object('outcome',p_outcome,'actor_type','SYSTEM','source_channel','EMAIL_INTAKE'));
 END IF;
 RETURN jsonb_build_object('status',p_outcome);
END $$;
REVOKE ALL ON FUNCTION private.email_document_pair_outcome(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fiscal_intake_prepare_companion(p_actor jsonb,p_fundo_id uuid,p_cedente_fundo_id uuid,p_estabelecimento_id uuid,
 p_fiscal_key text,p_file_sha256 text,p_document_code text,p_facts jsonb,p_file_name text,p_size_bytes bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.fiscal_identity_reservations; n public.notas_fiscais; c private.fiscal_document_claims;
 t public.documento_tipos; v_hash text; v_cedente uuid; v_req uuid; v_path text; v_intent uuid; v_sum integer:=0; v_weight integer:=2; v_digit integer;
 v_version uuid; v_doc uuid; v_original uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor->>'type' IS DISTINCT FROM 'SYSTEM' OR p_actor->>'source' IS DISTINCT FROM 'EMAIL_INTAKE'
  THEN RAISE EXCEPTION 'FISCAL_ACTOR_DENIED' USING ERRCODE='42501'; END IF;
 IF p_fiscal_key IS NULL OR p_fiscal_key !~ '^[0-9]{44}$' OR p_document_code NOT IN('nf_xml','nf_danfe_pdf') OR p_document_code IS NULL
  OR p_file_sha256 IS NULL OR p_file_sha256 !~ '^[a-f0-9]{64}$' OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 20971520
  OR nullif(p_file_name,'') IS NULL OR length(p_file_name)>255 OR jsonb_typeof(p_facts) IS DISTINCT FROM 'object'
  OR p_facts->>'chave_acesso' IS DISTINCT FROM p_fiscal_key THEN RAISE EXCEPTION 'FISCAL_DOCUMENT_INVALID' USING ERRCODE='22023'; END IF;
 FOR j IN REVERSE 43..1 LOOP v_sum:=v_sum+substring(p_fiscal_key,j,1)::integer*v_weight; v_weight:=CASE WHEN v_weight=9 THEN 2 ELSE v_weight+1 END; END LOOP;
 v_digit:=CASE WHEN v_sum%11<2 THEN 0 ELSE 11-v_sum%11 END;
 IF substring(p_fiscal_key,44,1)::integer<>v_digit THEN RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID' USING ERRCODE='22023'; END IF;
 v_cedente:=private.fiscal_validate_actor(p_actor,p_fundo_id,p_cedente_fundo_id,p_estabelecimento_id);
 IF NOT EXISTS(SELECT 1 FROM public.cedente_estabelecimentos e WHERE e.id=p_estabelecimento_id AND e.cnpj=substring(p_fiscal_key,7,14)) THEN RAISE EXCEPTION 'FISCAL_IDENTITY_INVALID' USING ERRCODE='22023'; END IF;
 v_hash:=encode(extensions.digest(p_fiscal_key,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('NFE:'||v_hash,0));
 UPDATE private.email_intake_attachments SET document_code=p_document_code,fiscal_identity_sha256=v_hash WHERE id=(p_actor->>'attachmentId')::uuid;
 -- Attachment names classify a format only; pairing always uses parsed exact identity.
 IF p_document_code='nf_danfe_pdf' THEN
  IF EXISTS(SELECT 1 FROM private.email_intake_attachments a WHERE a.message_id=(p_actor->>'messageId')::uuid AND a.id<>(p_actor->>'attachmentId')::uuid
    AND (lower(a.file_name) LIKE '%.xml' OR lower(a.content_type) IN('application/xml','text/xml')) AND a.status IN('PENDING','PROCESSING','RETRY','CLEANUP_PENDING'))
   THEN RETURN private.email_document_pair_outcome(p_actor,'WAITING_CANONICAL_XML'); END IF;
  IF EXISTS(SELECT 1 FROM private.email_intake_attachments a LEFT JOIN public.notas_fiscais x ON x.id=a.nota_fiscal_id
    WHERE a.message_id=(p_actor->>'messageId')::uuid AND a.id<>(p_actor->>'attachmentId')::uuid
    AND (lower(a.file_name) LIKE '%.xml' OR lower(a.content_type) IN('application/xml','text/xml'))
    AND (a.status NOT IN('IMPORTED','COMPANION_LINKED','DUPLICATE') OR coalesce(a.fiscal_identity_sha256,encode(extensions.digest(x.chave_acesso,'sha256'),'hex')) IS DISTINCT FROM v_hash))
   THEN RETURN private.email_document_pair_outcome(p_actor,'AMBIGUOUS'); END IF;
 END IF;
 SELECT * INTO n FROM public.notas_fiscais WHERE chave_acesso=p_fiscal_key FOR UPDATE;
 IF n.id IS NULL THEN RETURN jsonb_build_object('status','CREATE_NF'); END IF;
 SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=n.fiscal_reservation_id FOR SHARE;
 IF r.id IS NULL OR r.state<>'COMPLETED' OR r.document_type<>'NFE' OR r.identity_sha256<>v_hash OR r.integration_id IS DISTINCT FROM (p_actor->>'integrationId')::uuid
  OR n.tipo_documento_fiscal<>'NFE' OR n.fundo_id IS DISTINCT FROM p_fundo_id OR n.cedente_id IS DISTINCT FROM v_cedente
  OR n.cedente_fundo_id IS DISTINCT FROM p_cedente_fundo_id OR n.estabelecimento_id IS DISTINCT FROM p_estabelecimento_id
  OR r.fundo_id IS DISTINCT FROM n.fundo_id OR r.cedente_id IS DISTINCT FROM n.cedente_id OR r.cedente_fundo_id IS DISTINCT FROM n.cedente_fundo_id
  THEN RETURN private.email_document_pair_outcome(p_actor,'AMBIGUOUS'); END IF;
 IF (nullif(p_facts->>'numero_nf','') IS NOT NULL AND ltrim(p_facts->>'numero_nf','0') IS DISTINCT FROM ltrim(n.numero_nf,'0'))
  OR (nullif(p_facts->>'serie','') IS NOT NULL AND ltrim(p_facts->>'serie','0') IS DISTINCT FROM ltrim(n.serie,'0'))
  OR (nullif(p_facts->>'cnpj_emitente','') IS NOT NULL AND p_facts->>'cnpj_emitente' IS DISTINCT FROM n.cnpj_emitente)
  OR (nullif(p_facts->>'cnpj_destinatario','') IS NOT NULL AND p_facts->>'cnpj_destinatario' IS DISTINCT FROM n.cnpj_destinatario)
  OR (nullif(p_facts->>'data_emissao','') IS NOT NULL AND (p_facts->>'data_emissao')::date IS DISTINCT FROM n.data_emissao)
  OR (nullif(p_facts->>'valor_bruto','') IS NOT NULL AND abs((p_facts->>'valor_bruto')::numeric-n.valor_bruto)>0.01)
  THEN RETURN private.email_document_pair_outcome(p_actor,'AMBIGUOUS'); END IF;
 SELECT * INTO t FROM public.documento_tipos WHERE codigo=p_document_code AND ativo;
 IF t.id IS NULL OR p_size_bytes>t.tamanho_max_bytes OR NOT((CASE WHEN p_document_code='nf_xml' THEN 'application/xml' ELSE 'application/pdf' END)=ANY(t.mime_types_aceitos)) THEN RAISE EXCEPTION 'FISCAL_DOCUMENT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT v.id,d.id INTO v_version,v_doc FROM public.documento_vinculos l JOIN public.documentos_repositorio d ON d.id=l.documento_id AND d.documento_tipo_id=t.id AND d.deleted_at IS NULL
  JOIN public.documento_versoes v ON v.documento_id=d.id AND v.sha256=p_file_sha256 WHERE l.nota_fiscal_id=n.id ORDER BY v.numero_versao DESC LIMIT 1;
 IF v_version IS NOT NULL THEN
  IF p_file_sha256=r.file_sha256 AND EXISTS(SELECT 1 FROM private.fiscal_storage_intents o WHERE o.reservation_id=r.id AND o.owner_token=r.owner_token AND o.generation=r.generation AND o.state='RETAINED' AND EXISTS(SELECT 1 FROM public.documento_versoes original WHERE original.id=v_version AND original.bucket=o.bucket AND original.path=o.path)) THEN
   RETURN jsonb_build_object('status','DUPLICATE');
  END IF;
  PERFORM private.email_complete_companion(p_actor,n.id,p_file_sha256,p_document_code); RETURN jsonb_build_object('status','COMPANION_LINKED','nfId',n.id,'numero',n.numero_nf);
 END IF;
 SELECT * INTO c FROM private.fiscal_document_claims WHERE reservation_id=r.id AND document_code=p_document_code AND file_sha256=p_file_sha256 FOR UPDATE;
 IF c.state='COMPLETED' THEN PERFORM private.email_complete_companion(p_actor,n.id,p_file_sha256,p_document_code); RETURN jsonb_build_object('status','COMPANION_LINKED','nfId',n.id,'numero',n.numero_nf); END IF;
 IF c.state='RESERVED' AND c.lease_expires_at>clock_timestamp() THEN RETURN jsonb_build_object('status','IN_PROGRESS'); END IF;
 IF c.id IS NOT NULL AND EXISTS(SELECT 1 FROM private.fiscal_storage_intents WHERE id=c.storage_intent_id AND state<>'DELETED') THEN
  UPDATE private.fiscal_document_claims SET state='CLEANUP_PENDING',updated_at=clock_timestamp() WHERE id=c.id;
  UPDATE private.fiscal_storage_intents SET state='DELETE_PENDING',retry_at=clock_timestamp() WHERE id=c.storage_intent_id AND state NOT IN('RETAINED','DELETED');
  RETURN jsonb_build_object('status','CLEANUP_PENDING');
 END IF;
 SELECT id INTO v_req FROM public.documento_requisito_instancias WHERE nota_fiscal_id=n.id AND tipo_documento_codigo_snapshot=p_document_code AND status NOT IN('cancelado','satisfeito') ORDER BY id LIMIT 1;
 IF v_req IS NULL AND EXISTS(SELECT 1 FROM public.documento_requisito_instancias WHERE nota_fiscal_id=n.id AND tipo_documento_codigo_snapshot=p_document_code AND status='satisfeito') THEN RETURN private.email_document_pair_outcome(p_actor,'AMBIGUOUS'); END IF;
 INSERT INTO private.fiscal_document_claims(reservation_id,nota_fiscal_id,document_code,file_sha256,actor,requirement_id,file_name,mime_type,size_bytes)
  VALUES(r.id,n.id,p_document_code,p_file_sha256,p_actor,v_req,p_file_name,CASE WHEN p_document_code='nf_xml' THEN 'application/xml' ELSE 'application/pdf' END,p_size_bytes)
  ON CONFLICT(reservation_id,document_code,file_sha256) DO UPDATE SET owner_token=gen_random_uuid(),generation=private.fiscal_document_claims.generation+1,
   state='RESERVED',lease_expires_at=clock_timestamp()+interval '5 minutes',actor=EXCLUDED.actor,requirement_id=EXCLUDED.requirement_id,storage_intent_id=NULL,updated_at=clock_timestamp() RETURNING * INTO c;
 v_path:=r.id::text||'/'||c.generation::text||'/'||c.id::text||'-'||gen_random_uuid()::text||CASE WHEN p_document_code='nf_xml' THEN '.xml' ELSE '.pdf' END;
 INSERT INTO private.fiscal_storage_intents(reservation_id,generation,owner_token,bucket,path,sha256) VALUES(r.id,c.generation,c.owner_token,'documentos-v2',v_path,p_file_sha256) RETURNING id INTO v_intent;
 UPDATE private.fiscal_document_claims SET storage_intent_id=v_intent WHERE id=c.id;
 RETURN jsonb_build_object('status','DOCUMENT','claim',jsonb_build_object('id',c.id,'token',c.owner_token,'generation',c.generation),
  'intent',jsonb_build_object('id',v_intent,'bucket','documentos-v2','path',v_path));
END $$;

CREATE FUNCTION public.fiscal_intake_commit_companion(p_id uuid,p_token uuid,p_generation bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.fiscal_document_claims; n public.notas_fiscais; o private.fiscal_storage_intents; v_type uuid; v_doc jsonb; v_metadata jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FISCAL_ACTOR_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM private.fiscal_document_claims WHERE id=p_id;
 IF c.id IS NULL THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST' USING ERRCODE='42501'; END IF;
 IF c.owner_token IS DISTINCT FROM p_token OR c.generation IS DISTINCT FROM p_generation THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST' USING ERRCODE='42501'; END IF;
 IF c.state='COMPLETED' THEN RETURN jsonb_build_object('status','COMPANION_LINKED','nfId',c.nota_fiscal_id,'numero',(SELECT numero_nf FROM public.notas_fiscais WHERE id=c.nota_fiscal_id)); END IF;
 PERFORM private.fiscal_assert_document_nf(c.nota_fiscal_id,c.reservation_id,p_token,p_generation);
 SELECT * INTO c FROM private.fiscal_document_claims WHERE id=p_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('NFE:'||(SELECT identity_sha256 FROM private.fiscal_identity_reservations WHERE id=c.reservation_id),0));
 SELECT * INTO c FROM private.fiscal_document_claims WHERE id=p_id FOR UPDATE;
 SELECT * INTO n FROM public.notas_fiscais WHERE id=c.nota_fiscal_id FOR SHARE;
 SELECT * INTO o FROM private.fiscal_storage_intents WHERE id=c.storage_intent_id AND owner_token=p_token AND generation=p_generation AND state IN('PLANNED','STORED') FOR UPDATE;
 IF o.id IS NULL OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=o.bucket AND name=o.path) THEN RAISE EXCEPTION 'FISCAL_STORAGE_UNCONFIRMED'; END IF;
 SELECT id INTO v_type FROM public.documento_tipos WHERE codigo=c.document_code AND ativo;
 v_doc:=private.fiscal_registrar_documento_upload(n.id,c.requirement_id,v_type,c.file_name,c.mime_type,c.size_bytes,c.file_sha256,o.bucket,o.path,NULL,NULL,c.reservation_id,c.owner_token,c.generation);
 PERFORM private.fiscal_reconciliar_documentos_base_nf(n.id,c.reservation_id,c.owner_token,c.generation);
 v_metadata:=jsonb_build_object('outcome','COMPANION_LINKED','document_code',c.document_code,'document_id',v_doc->>'documento_id','actor_type','SYSTEM','source_channel','EMAIL_INTAKE',
   'event',CASE WHEN c.document_code='nf_xml' THEN 'XML_DOCUMENT_LINKED' ELSE 'DANFE_COMPANION_LINKED' END,'requirement_linked',c.requirement_id IS NOT NULL,
   'requirement_event',CASE WHEN c.requirement_id IS NOT NULL THEN 'REQUIREMENT_LINKED' ELSE NULL END);
 INSERT INTO public.logs_auditoria(usuario_id,ator_tipo,origem,tipo_evento,entidade_tipo,entidade_id,dados_depois) VALUES(NULL,'sistema','fiscal_intake','FISCAL_DOCUMENT_LINKED','notas_fiscais',n.id,v_metadata);
 INSERT INTO public.eventos_dominio(tenant_id,fundo_id,cedente_id,cedente_fundo_id,nota_fiscal_id,tipo_evento,categoria,ator_nome_snapshot,ator_perfil_snapshot,origem,descricao,metadata,visibilidade,origem_evento,origem_registro_id)
  VALUES(n.fundo_id,n.fundo_id,n.cedente_id,n.cedente_fundo_id,n.id,'documento_fiscal_complementar_vinculado','documento','Entrada de documentos por e-mail','sistema','fiscal_intake',
    'Documento fiscal complementar vinculado à nota existente.',v_metadata,'ambos','fiscal_document_claims',c.id::text);
 UPDATE private.fiscal_storage_intents SET state='RETAINED',updated_at=clock_timestamp() WHERE id=o.id;
 UPDATE private.fiscal_document_claims SET state='COMPLETED',document_id=(v_doc->>'documento_id')::uuid,version_id=(v_doc->>'versao_id')::uuid,updated_at=clock_timestamp() WHERE id=c.id;
 PERFORM private.email_complete_companion(c.actor,n.id,c.file_sha256,c.document_code);
 RETURN jsonb_build_object('status','COMPANION_LINKED','nfId',n.id,'numero',n.numero_nf);
END $$;

CREATE FUNCTION public.fiscal_intake_abort_companion(p_id uuid,p_token uuid,p_generation bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.fiscal_document_claims; v_state text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FISCAL_ACTOR_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM private.fiscal_document_claims WHERE id=p_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('NFE:'||(SELECT identity_sha256 FROM private.fiscal_identity_reservations WHERE id=c.reservation_id),0));
 SELECT * INTO c FROM private.fiscal_document_claims WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR c.owner_token IS DISTINCT FROM p_token OR c.generation IS DISTINCT FROM p_generation THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST' USING ERRCODE='42501'; END IF;
 IF c.state='COMPLETED' THEN RETURN jsonb_build_object('status','COMPANION_LINKED','nfId',c.nota_fiscal_id,'numero',(SELECT numero_nf FROM public.notas_fiscais WHERE id=c.nota_fiscal_id)); END IF;
 UPDATE private.fiscal_storage_intents SET state='DELETE_PENDING',retry_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=c.storage_intent_id AND state NOT IN('DELETED','RETAINED');
 v_state:=CASE WHEN EXISTS(SELECT 1 FROM private.fiscal_storage_intents WHERE id=c.storage_intent_id AND state<>'DELETED') THEN 'CLEANUP_PENDING' ELSE 'RELEASED' END;
 UPDATE private.fiscal_document_claims SET state=v_state,updated_at=clock_timestamp() WHERE id=c.id;
 RETURN jsonb_build_object('status',CASE WHEN v_state='RELEASED' THEN 'FAILED' ELSE v_state END);
END $$;
REVOKE ALL ON FUNCTION public.fiscal_intake_prepare_companion(jsonb,uuid,uuid,uuid,text,text,text,jsonb,text,bigint),public.fiscal_intake_commit_companion(uuid,uuid,bigint),public.fiscal_intake_abort_companion(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_prepare_companion(jsonb,uuid,uuid,uuid,text,text,text,jsonb,text,bigint),public.fiscal_intake_commit_companion(uuid,uuid,bigint),public.fiscal_intake_abort_companion(uuid,uuid,bigint) TO service_role;

-- Waiting uses existing durable RETRY; waiting does not exhaust the file's attempt budget.
CREATE OR REPLACE FUNCTION public.email_intake_settle_attachment(p_id uuid,p_token uuid,p_outcome text,p_retry_after_ms integer DEFAULT 30000)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.email_intake_attachments; v_status text;
BEGIN
 SELECT * INTO a FROM private.email_intake_attachments WHERE id=p_id AND lease_token=p_token AND status='PROCESSING' AND lease_expires_at>clock_timestamp() FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'EMAIL_LEASE_LOST' USING ERRCODE='42501'; END IF;
 v_status:=CASE p_outcome WHEN 'DUPLICATE' THEN 'DUPLICATE' WHEN 'IN_PROGRESS' THEN 'RETRY' WHEN 'WAITING_CANONICAL_XML' THEN 'RETRY'
  WHEN 'UNKNOWN_CEDENTE' THEN 'QUARANTINED' WHEN 'ROUTING_DENIED' THEN 'QUARANTINED' WHEN 'AMBIGUOUS' THEN 'REJECTED'
  WHEN 'INVALID' THEN 'REJECTED' WHEN 'MISSING_IDENTITY' THEN 'REJECTED' WHEN 'RETRYABLE_ERROR' THEN 'RETRY' WHEN 'FAILED' THEN 'FAILED'
  WHEN 'CLEANUP_PENDING' THEN 'CLEANUP_PENDING' WHEN 'IGNORED' THEN 'IGNORED' ELSE NULL END;
 IF v_status IS NULL THEN RAISE EXCEPTION 'EMAIL_INVALID_OUTCOME'; END IF;
 IF v_status='RETRY' AND a.attempts>=a.max_attempts AND p_outcome<>'WAITING_CANONICAL_XML' THEN v_status:='FAILED'; END IF;
 UPDATE private.email_intake_attachments SET status=v_status,lease_token=NULL,lease_expires_at=NULL,
  attempts=CASE WHEN p_outcome='WAITING_CANONICAL_XML' THEN greatest(attempts-1,0) ELSE attempts END,
  last_error_code=CASE WHEN v_status IN('DUPLICATE','IGNORED') THEN NULL ELSE p_outcome END,
  completed_at=CASE WHEN v_status IN('RETRY','CLEANUP_PENDING') THEN NULL ELSE clock_timestamp() END,
  available_at=clock_timestamp()+least(greatest(coalesce(p_retry_after_ms,30000),1000),900000)*interval '1 millisecond' WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION private.fiscal_registrar_documento_upload(
  p_nota_fiscal_id uuid,
  p_requisito_id uuid,
  p_documento_tipo_id uuid,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_bucket text,
  p_path text,
  p_enviado_por uuid,
  p_substitui_versao_id uuid DEFAULT NULL
,
  p_reservation_id uuid DEFAULT NULL, p_owner_token uuid DEFAULT NULL, p_generation bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_role text;
  nf_cedente uuid;
  nf_cedente_fundo uuid;
  nf_fundo uuid;
  requirement record;
  doc_id uuid;
  version_id uuid;
  version_number integer;
  same_hash boolean;
BEGIN
  IF p_reservation_id IS NOT NULL THEN
    PERFORM private.fiscal_assert_document_nf(p_nota_fiscal_id,p_reservation_id,p_owner_token,p_generation);
  END IF;
  actor_role := public.get_user_role();
  IF p_reservation_id IS NULL AND (auth.uid() IS NULL OR actor_role NOT IN ('gestor', 'cedente', 'consultor') OR p_enviado_por <> auth.uid()) THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar documento';
  END IF;

  SELECT cedente_id, cedente_fundo_id, fundo_id
    INTO nf_cedente, nf_cedente_fundo, nf_fundo
  FROM public.notas_fiscais
  WHERE id = p_nota_fiscal_id;

  IF nf_cedente IS NULL THEN RAISE EXCEPTION 'Nota fiscal nao encontrada'; END IF;
  IF nf_cedente_fundo IS NULL OR nf_fundo IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto cedente-fundo/fundo';
  END IF;
  IF actor_role = 'cedente' AND nf_cedente <> public.get_user_cedente_id() THEN RAISE EXCEPTION 'NF fora do cedente autenticado'; END IF;
  IF actor_role = 'consultor' AND (
    NOT private.usuario_pode_operar_cedente(nf_cedente)
    OR NOT private.consultor_tem_acesso_fundo(nf_fundo)
  ) THEN RAISE EXCEPTION 'Consultor sem acesso operacional a NF'; END IF;

  IF p_reservation_id IS NOT NULL AND p_enviado_por IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'FISCAL_ACTOR_DENIED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO requirement
  FROM public.documento_requisito_instancias
  WHERE id = p_requisito_id
    AND nota_fiscal_id = p_nota_fiscal_id
    AND status NOT IN ('cancelado', 'satisfeito')
  FOR UPDATE;

  IF requirement.id IS NULL AND NOT (p_requisito_id IS NULL AND p_reservation_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.documento_tipos t WHERE t.id=p_documento_tipo_id AND t.codigo IN('nf_xml','nf_danfe_pdf') AND t.ativo)) THEN RAISE EXCEPTION 'Requisito documental invalido ou ja satisfeito'; END IF;
  IF requirement.cedente_id <> nf_cedente THEN RAISE EXCEPTION 'Requisito documental fora do cedente da NF'; END IF;
  IF requirement.id IS NOT NULL AND NOT public.documento_tipo_compativel_com_requisito(requirement.tipo_documento_codigo_snapshot, p_documento_tipo_id) THEN
    RAISE EXCEPTION 'Tipo de documento nao corresponde ao requisito';
  END IF;
  IF p_bucket <> 'documentos-v2' OR length(p_path) = 0 OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadados de armazenamento invalidos';
  END IF;

  doc_id := requirement.documento_id;
  IF p_requisito_id IS NULL THEN
    SELECT d.id INTO doc_id FROM public.documento_vinculos l JOIN public.documentos_repositorio d ON d.id=l.documento_id
      WHERE l.nota_fiscal_id=p_nota_fiscal_id AND d.documento_tipo_id=p_documento_tipo_id AND d.deleted_at IS NULL ORDER BY d.id LIMIT 1;
  END IF;
  IF doc_id IS NULL THEN
    INSERT INTO public.documentos_repositorio (documento_tipo_id, status, criado_por, fiscal_reservation_id)
    VALUES (p_documento_tipo_id, 'pendente', p_enviado_por, p_reservation_id)
    RETURNING id INTO doc_id;

    INSERT INTO public.documento_vinculos (documento_id, nota_fiscal_id, cedente_id)
    VALUES (doc_id, p_nota_fiscal_id, nf_cedente);
  ELSE
    UPDATE public.documentos_repositorio
    SET documento_tipo_id = p_documento_tipo_id
    WHERE id = doc_id
      AND documento_tipo_id IS DISTINCT FROM p_documento_tipo_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(doc_id::text, 0));
  SELECT COALESCE(max(numero_versao), 0) + 1 INTO version_number
  FROM public.documento_versoes WHERE documento_id = doc_id;
  SELECT EXISTS (SELECT 1 FROM public.documento_versoes WHERE documento_id = doc_id AND sha256 = lower(p_sha256)) INTO same_hash;

  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,
    status, substitui_versao_id, enviado_por, fiscal_reservation_id
  ) VALUES (
    doc_id, version_number, p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256),
    'em_analise', p_substitui_versao_id, p_enviado_por, p_reservation_id
  ) RETURNING id INTO version_id;

  UPDATE public.documentos_repositorio SET status = 'em_analise', deleted_at = NULL WHERE id = doc_id;
  UPDATE public.documento_requisito_instancias
  SET documento_id = doc_id,
      documento_tipo_id = p_documento_tipo_id,
      versao_aprovada_id = NULL,
      status = 'pendente',
      satisfeito_em = NULL
  WHERE id = p_requisito_id;

  RETURN jsonb_build_object(
    'documento_id', doc_id,
    'versao_id', version_id,
    'numero_versao', version_number,
    'sha256_igual', same_hash,
    'cedente_fundo_id', nf_cedente_fundo,
    'fundo_id', nf_fundo
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.fiscal_reconciliar_documentos_base_nf(
  p_nota_fiscal_id uuid
,
  p_reservation_id uuid DEFAULT NULL, p_owner_token uuid DEFAULT NULL, p_generation bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  item record;
  nf_context record;
  actor_role text;
  satisfeitas integer := 0;
  pendentes integer := 0;
  divergencias integer := 0;
  reconciliadas integer := 0;
  auto_aprovadas integer := 0;
  aprovacao_manual integer := 0;
  v_satisfeito boolean;
  v_event_origin text;
BEGIN
  IF p_reservation_id IS NOT NULL THEN
    PERFORM private.fiscal_assert_document_nf(p_nota_fiscal_id,p_reservation_id,p_owner_token,p_generation);
  END IF;
  actor_role := public.get_user_role();

  IF p_reservation_id IS NULL AND (auth.uid() IS NULL OR actor_role NOT IN ('gestor', 'cedente', 'consultor')) THEN
    RAISE EXCEPTION 'Usuario sem permissao para reconciliar documentos da NF';
  END IF;

  SELECT nf.id, nf.fundo_id, nf.cedente_id, nf.cedente_fundo_id
    INTO nf_context
  FROM public.notas_fiscais nf
  WHERE nf.id = p_nota_fiscal_id;

  IF nf_context.id IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal nao encontrada';
  END IF;

  IF actor_role = 'cedente'
     AND nf_context.cedente_id <> public.get_user_cedente_id() THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;

  IF actor_role = 'consultor' AND (
    NOT private.usuario_pode_operar_cedente(nf_context.cedente_id)
    OR NOT private.consultor_tem_acesso_fundo(nf_context.fundo_id)
  ) THEN
    RAISE EXCEPTION 'Consultor sem acesso operacional a nota fiscal';
  END IF;

  FOR item IN
    SELECT
      dri.id AS requisito_id,
      dri.tipo_documento_codigo_snapshot,
      dri.status AS requisito_status,
      dri.documento_id AS documento_atual_id,
      dri.nivel_validacao_snapshot,
      candidate.documento_id AS documento_base_id,
      candidate.versao_id AS versao_base_id,
      candidate.versao_status AS versao_base_status,
      candidate.numero_versao AS versao_base_numero
    FROM public.documento_requisito_instancias dri
    LEFT JOIN LATERAL (
      SELECT
        dr.id AS documento_id,
        dv.id AS versao_id,
        dv.status AS versao_status,
        dv.numero_versao
      FROM public.documento_vinculos vinculo
      JOIN public.documentos_repositorio dr
        ON dr.id = vinculo.documento_id
       AND dr.deleted_at IS NULL
      JOIN public.documento_tipos document_type
        ON document_type.id = dr.documento_tipo_id
       AND document_type.codigo = dri.tipo_documento_codigo_snapshot
      JOIN LATERAL (
        SELECT dv.id, dv.status, dv.numero_versao, dv.created_at
        FROM public.documento_versoes dv
        WHERE dv.documento_id = dr.id
        ORDER BY dv.numero_versao DESC, dv.created_at DESC
        LIMIT 1
      ) dv ON dv.status IN ('enviado', 'em_analise', 'aprovado')
      WHERE vinculo.nota_fiscal_id = p_nota_fiscal_id
      ORDER BY dv.numero_versao DESC, dv.created_at DESC
      LIMIT 1
    ) candidate ON true
    WHERE dri.nota_fiscal_id = p_nota_fiscal_id
      AND dri.escopo_snapshot = 'nf_pre_cessao'
      AND dri.tipo_documento_codigo_snapshot IN ('nf_xml', 'nf_danfe_pdf')
      AND dri.status NOT IN ('cancelado', 'dispensado')
    ORDER BY dri.id
    FOR UPDATE OF dri
  LOOP
    IF item.documento_base_id IS NULL THEN
      IF item.documento_atual_id IS NOT NULL THEN
        divergencias := divergencias + 1;
        v_event_origin := item.requisito_id::text || ':incompativel';
        INSERT INTO public.eventos_dominio (
          tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
          tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
          ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
          origem_evento, origem_registro_id
        )
        SELECT
          nf_context.fundo_id, nf_context.fundo_id, nf_context.cedente_id,
          nf_context.cedente_fundo_id, p_nota_fiscal_id,
          'documento_base_nf_incompativel', 'documento', auth.uid(),
          COALESCE(profile.nome_completo, profile.email, 'Sistema'),
          COALESCE(profile.role::text, 'sistema'), 'reconciliacao_checklist',
          'Documento-base existente nao corresponde ao tipo documental do requisito.',
          jsonb_build_object(
            'requisito_id', item.requisito_id,
            'documento_id', item.documento_atual_id,
            'tipo_esperado', 'nf_xml ou nf_danfe_pdf'
          ), 'interno', 'documento_requisito_instancias', v_event_origin
        FROM public.profiles profile
        WHERE profile.id = auth.uid()
        ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
          WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL
        DO NOTHING;
      END IF;

      IF item.requisito_status = 'satisfeito' THEN
        UPDATE public.documento_requisito_instancias
        SET status = 'pendente', versao_aprovada_id = NULL, satisfeito_em = NULL
        WHERE id = item.requisito_id;
      END IF;
      pendentes := pendentes + 1;
      CONTINUE;
    END IF;

    reconciliadas := reconciliadas + 1;
    v_satisfeito := item.versao_base_status = 'aprovado';

    IF item.nivel_validacao_snapshot = 'estrutural'
       AND item.versao_base_status IN ('enviado', 'em_analise') THEN
      UPDATE public.documento_versoes
      SET status = 'aprovado'
      WHERE id = item.versao_base_id
        AND status IN ('enviado', 'em_analise');

      UPDATE public.documentos_repositorio
      SET status = 'aprovado'
      WHERE id = item.documento_base_id;

      IF NOT EXISTS (
        SELECT 1
        FROM public.documento_analises da
        WHERE da.documento_versao_id = item.versao_base_id
          AND da.resultado = 'aprovado'
      ) THEN
        INSERT INTO public.documento_analises (
          documento_versao_id, resultado, analisado_por, ator_tipo,
          observacoes, dados_estruturados
        ) VALUES (
          item.versao_base_id, 'aprovado', NULL, 'sistema',
          'Documento-base da NF validado estruturalmente no cadastro.',
          jsonb_build_object('origem', 'documento_base_nf', 'fiscal_reservation_id', p_reservation_id,
        'actor_type', CASE WHEN auth.uid() IS NULL THEN 'SYSTEM' ELSE 'HUMAN' END, 'nota_fiscal_id', p_nota_fiscal_id)
        );
      END IF;

      v_satisfeito := true;
      auto_aprovadas := auto_aprovadas + 1;
    ELSIF item.versao_base_status <> 'aprovado' THEN
      aprovacao_manual := aprovacao_manual + 1;
    END IF;

    IF v_satisfeito THEN
      UPDATE public.documento_requisito_instancias
      SET documento_id = item.documento_base_id,
          versao_aprovada_id = item.versao_base_id,
          status = 'satisfeito',
          satisfeito_em = COALESCE(satisfeito_em, now()),
          origem_snapshot = 'documento_base_nf'
      WHERE id = item.requisito_id;
      satisfeitas := satisfeitas + 1;
    ELSE
      UPDATE public.documento_requisito_instancias
      SET documento_id = item.documento_base_id,
          versao_aprovada_id = NULL,
          status = 'pendente',
          satisfeito_em = NULL,
          origem_snapshot = 'documento_base_nf'
      WHERE id = item.requisito_id;
      pendentes := pendentes + 1;
    END IF;

    v_event_origin := item.versao_base_id::text;
    INSERT INTO public.eventos_dominio (
      tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
      tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
      ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
      origem_evento, origem_registro_id
    )
    SELECT
      nf_context.fundo_id, nf_context.fundo_id, nf_context.cedente_id,
      nf_context.cedente_fundo_id, p_nota_fiscal_id,
      CASE WHEN v_satisfeito THEN 'documento_base_nf_reconciliado' ELSE 'documento_base_nf_enviado' END,
      'documento', auth.uid(), COALESCE(profile.nome_completo, profile.email, 'Sistema'),
      COALESCE(profile.role::text, 'sistema'), 'reconciliacao_checklist',
      CASE
        WHEN item.tipo_documento_codigo_snapshot = 'nf_xml' AND v_satisfeito THEN 'O XML da NF-e utilizado no cadastro satisfez o requisito documental.'
        WHEN item.tipo_documento_codigo_snapshot = 'nf_danfe_pdf' AND v_satisfeito THEN 'O DANFE utilizado no cadastro satisfez o requisito documental.'
        ELSE 'Documento-base da NF localizado e aguardando analise conforme a politica.'
      END,
      jsonb_build_object(
        'requisito_id', item.requisito_id,
        'documento_id', item.documento_base_id,
        'documento_versao_id', item.versao_base_id,
        'numero_versao', item.versao_base_numero,
        'tipo_validacao', item.nivel_validacao_snapshot,
        'status', CASE WHEN v_satisfeito THEN 'satisfeito' ELSE 'pendente' END,
        'origem', 'documento_base_nf'
      ), 'ambos', 'documento_requisito_instancias', v_event_origin
    FROM (SELECT 1) actor_row LEFT JOIN public.profiles profile ON profile.id = auth.uid()
    ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
      WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL
    DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'nota_fiscal_id', p_nota_fiscal_id,
    'instanciasCriadas', 0,
    'instanciasSatisfeitas', satisfeitas,
    'instanciasPendentes', pendentes,
    'reconciliados', reconciliadas,
    'autoAprovados', auto_aprovadas,
    'aguardandoAnalise', aprovacao_manual,
    'divergencias', divergencias
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_intake_prepare_storage(p_id uuid,p_token uuid,p_generation bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.fiscal_identity_reservations%ROWTYPE; s private.fiscal_prepared_imports%ROWTYPE;
  v_policy uuid; v_version uuid; v_type public.documento_tipos%ROWTYPE; v_required boolean; v_intent jsonb;
BEGIN
  r := private.fiscal_assert_owner(p_id,p_token,p_generation);
  SELECT * INTO s FROM private.fiscal_prepared_imports WHERE reservation_id=p_id AND generation=p_generation AND owner_token=p_token FOR UPDATE;
  IF s.reservation_id IS NULL THEN RAISE EXCEPTION 'FISCAL_PREPARATION_INVALID'; END IF;
  IF s.storage_intent_id IS NOT NULL THEN
    RETURN (SELECT jsonb_build_object('id',id,'bucket',bucket,'path',path) FROM private.fiscal_storage_intents WHERE id=s.storage_intent_id);
  END IF;
  SELECT po.id,pov.id INTO v_policy,v_version FROM public.cedente_fundo_politicas cfp
    JOIN public.politicas_operacionais po ON po.id=cfp.politica_operacional_id AND po.fundo_id=r.fundo_id AND po.status='ativa'
    JOIN public.politica_operacional_versoes pov ON pov.politica_operacional_id=po.id AND pov.fundo_id=r.fundo_id
      AND pov.status='publicada' AND pov.publicada_em IS NOT NULL AND pov.vigente_desde<=clock_timestamp()
      AND (pov.vigente_ate IS NULL OR pov.vigente_ate>clock_timestamp())
    WHERE cfp.cedente_fundo_id=r.cedente_fundo_id AND cfp.status='ativa' AND cfp.vigente_desde<=clock_timestamp()
      AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate>clock_timestamp())
    ORDER BY cfp.vigente_desde DESC,pov.versao DESC LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM public.politica_requisitos_documentais pr WHERE pr.politica_operacional_versao_id=v_version
    AND pr.tipo_documento_codigo=s.document_code AND pr.escopo='nf_pre_cessao' AND pr.ativo) INTO v_required;
  IF v_required OR r.document_type='NFE' THEN
    SELECT * INTO v_type FROM public.documento_tipos WHERE codigo=s.document_code AND ativo;
    IF v_type.id IS NULL OR s.size_bytes>v_type.tamanho_max_bytes OR NOT (s.mime_type=ANY(v_type.mime_types_aceitos))
      THEN RAISE EXCEPTION 'FISCAL_DOCUMENT_INVALID'; END IF;
  END IF;
  v_intent := public.fiscal_intake_plan_storage(p_id,p_token,p_generation,
    CASE WHEN v_type.id IS NOT NULL THEN 'documentos-v2' ELSE 'notas-fiscais' END,CASE WHEN s.document_code='nf_xml' THEN 'xml' ELSE 'pdf' END);
  UPDATE private.fiscal_prepared_imports SET politica_id=v_policy,politica_versao_id=v_version,document_type_id=v_type.id,
    storage_intent_id=(v_intent->>'id')::uuid WHERE reservation_id=p_id;
  RETURN v_intent;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_intake_commit(p_id uuid,p_token uuid,p_generation bigint,p_storage_intent_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.fiscal_identity_reservations%ROWTYPE; s private.fiscal_prepared_imports%ROWTYPE;
  o private.fiscal_storage_intents%ROWTYPE; n public.notas_fiscais%ROWTYPE;
  v_nf_id uuid := gen_random_uuid(); v_req uuid; v_actor uuid; v_metadata jsonb; v_previous public.notas_fiscais%ROWTYPE; v_original_path text;
BEGIN
  r := private.fiscal_assert_owner(p_id,p_token,p_generation);
  SELECT * INTO s FROM private.fiscal_prepared_imports WHERE reservation_id=p_id AND generation=p_generation AND owner_token=p_token FOR UPDATE;
  SELECT * INTO o FROM private.fiscal_storage_intents WHERE id=p_storage_intent_id AND reservation_id=p_id
    AND generation=p_generation AND owner_token=p_token AND state IN ('PLANNED','STORED') FOR UPDATE;
  IF s.reservation_id IS NULL OR o.id IS NULL OR s.storage_intent_id IS DISTINCT FROM o.id
    OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id=o.bucket AND name=o.path)
    THEN RAISE EXCEPTION 'FISCAL_STORAGE_UNCONFIRMED'; END IF;
  n := jsonb_populate_record(NULL::public.notas_fiscais,s.values_json);
  v_original_path := CASE WHEN o.bucket='notas-fiscais' THEN o.path ELSE NULL END;
  IF r.recovery_nf_id IS NOT NULL THEN
    SELECT * INTO v_previous FROM public.notas_fiscais WHERE id=r.recovery_nf_id FOR UPDATE;
    IF s.document_code<>'nf_xml' OR to_jsonb(v_previous) IS DISTINCT FROM r.recovery_snapshot
      OR NOT private.fiscal_can_recover_xml(r.recovery_nf_id,r.cedente_id,r.cedente_fundo_id,r.fundo_id)
      THEN RAISE EXCEPTION 'FISCAL_RECOVERY_CHANGED' USING ERRCODE='22023'; END IF;
    v_nf_id := r.recovery_nf_id;
    -- A pre-existing original stays attached to this same NF. The imported XML
    -- is retained by its own fenced journal/document version, not discarded.
    IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='notas-fiscais' AND name=v_previous.arquivo_url) THEN
      v_original_path := v_previous.arquivo_url;
    END IF;
    DELETE FROM public.documento_requisito_instancias WHERE nota_fiscal_id=v_nf_id;
    DELETE FROM public.nota_fiscal_parcelas WHERE nota_fiscal_id=v_nf_id;
  END IF;
  IF r.review_intent_id IS NOT NULL THEN
    n.fiscal_proveniencia := n.fiscal_proveniencia || jsonb_build_object('review_intent_id',r.review_intent_id);
  END IF;
  v_actor := CASE WHEN r.actor_type='HUMAN' THEN auth.uid() ELSE NULL END;
  INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,estabelecimento_id,
    numero_nf,serie,chave_acesso,data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,
    valor_bruto,valor_liquido,valor_icms,valor_iss,valor_pis,valor_cofins,valor_ipi,descricao_itens,quantidade_total,unidade_quantidade,
    itens_estruturados,condicao_pagamento,arquivo_url,status,tipo_documento_fiscal,valor_liquido_origem,vencimento_origem,fiscal_proveniencia,
    fiscal_reservation_id,source_channel)
  VALUES(v_nf_id,r.cedente_id,r.cedente_fundo_id,r.fundo_id,r.estabelecimento_id,
    n.numero_nf,n.serie,n.chave_acesso,n.data_emissao,n.data_vencimento,n.cnpj_emitente,n.razao_social_emitente,n.cnpj_destinatario,n.razao_social_destinatario,
    n.valor_bruto,n.valor_liquido,n.valor_icms,n.valor_iss,n.valor_pis,n.valor_cofins,n.valor_ipi,n.descricao_itens,n.quantidade_total,n.unidade_quantidade,
    n.itens_estruturados,n.condicao_pagamento,v_original_path,'rascunho',
    n.tipo_documento_fiscal,n.valor_liquido_origem,n.vencimento_origem,n.fiscal_proveniencia,r.id,r.source_channel)
  ON CONFLICT (id) DO UPDATE SET
    estabelecimento_id=EXCLUDED.estabelecimento_id,
    numero_nf=EXCLUDED.numero_nf,serie=EXCLUDED.serie,chave_acesso=EXCLUDED.chave_acesso,
    data_emissao=EXCLUDED.data_emissao,data_vencimento=EXCLUDED.data_vencimento,
    cnpj_emitente=EXCLUDED.cnpj_emitente,razao_social_emitente=EXCLUDED.razao_social_emitente,
    cnpj_destinatario=EXCLUDED.cnpj_destinatario,razao_social_destinatario=EXCLUDED.razao_social_destinatario,
    valor_bruto=EXCLUDED.valor_bruto,valor_liquido=EXCLUDED.valor_liquido,valor_icms=EXCLUDED.valor_icms,
    valor_iss=EXCLUDED.valor_iss,valor_pis=EXCLUDED.valor_pis,valor_cofins=EXCLUDED.valor_cofins,valor_ipi=EXCLUDED.valor_ipi,
    descricao_itens=EXCLUDED.descricao_itens,quantidade_total=EXCLUDED.quantidade_total,unidade_quantidade=EXCLUDED.unidade_quantidade,
    itens_estruturados=EXCLUDED.itens_estruturados,condicao_pagamento=EXCLUDED.condicao_pagamento,arquivo_url=EXCLUDED.arquivo_url,
    tipo_documento_fiscal=EXCLUDED.tipo_documento_fiscal,valor_liquido_origem=EXCLUDED.valor_liquido_origem,
    vencimento_origem=EXCLUDED.vencimento_origem,fiscal_proveniencia=EXCLUDED.fiscal_proveniencia,
    fiscal_reservation_id=EXCLUDED.fiscal_reservation_id,source_channel=EXCLUDED.source_channel;
  IF jsonb_array_length(s.parcelas)>0 THEN
    PERFORM private.fiscal_registrar_parcelas_nota_fiscal(v_nf_id,s.parcelas,p_id,p_token,p_generation);
  END IF;
  IF s.politica_versao_id IS NOT NULL THEN
    PERFORM private.fiscal_instanciar_requisitos_nota(v_nf_id,s.politica_id,s.politica_versao_id,p_id,p_token,p_generation);
  END IF;
  IF s.document_type_id IS NOT NULL THEN
    SELECT id INTO v_req FROM public.documento_requisito_instancias WHERE nota_fiscal_id=v_nf_id
      AND tipo_documento_codigo_snapshot=s.document_code AND status='pendente' ORDER BY id LIMIT 1;
    -- Optional base evidence is retained even when the policy does not require it.
    PERFORM private.fiscal_registrar_documento_upload(v_nf_id,v_req,s.document_type_id,s.file_name,s.mime_type,s.size_bytes,
      o.sha256,o.bucket,o.path,v_actor,NULL,p_id,p_token,p_generation);
    PERFORM private.fiscal_reconciliar_documentos_base_nf(v_nf_id,p_id,p_token,p_generation);
  END IF;
  v_metadata := jsonb_build_object('actor_type',r.actor_type,'actor_source',CASE WHEN r.actor_type='SYSTEM' THEN 'EMAIL_INTAKE' ELSE 'APP' END,
    'source_channel',r.source_channel,'fiscal_reservation_id',r.id,'integration_id',r.integration_id,'message_id',r.message_id,
    'attachment_id',r.attachment_id,'parser_strategy',n.fiscal_proveniencia->>'strategy','outcome','IMPORTED','document_role',CASE WHEN s.document_code='nf_xml' THEN 'XML_CANONICAL' ELSE 'DANFE_SOURCE' END,
    'ingest_actor',r.ingest_actor,'legacy_draft_recovered',r.recovery_nf_id IS NOT NULL,
    'review_actor',CASE WHEN r.review_intent_id IS NOT NULL THEN jsonb_build_object('type','HUMAN','userId',auth.uid()) ELSE NULL END);
  INSERT INTO public.logs_auditoria(usuario_id,ator_tipo,origem,tipo_evento,entidade_tipo,entidade_id,dados_depois)
    VALUES(v_actor,CASE WHEN v_actor IS NULL THEN 'sistema' ELSE 'usuario' END,'fiscal_intake','NF_SALVA_RASCUNHO','notas_fiscais',v_nf_id,v_metadata);
  INSERT INTO public.eventos_dominio(tenant_id,fundo_id,cedente_id,cedente_fundo_id,nota_fiscal_id,tipo_evento,categoria,
    ator_usuario_id,ator_nome_snapshot,ator_perfil_snapshot,origem,descricao,metadata,visibilidade,origem_evento,origem_registro_id)
    VALUES(r.fundo_id,r.fundo_id,r.cedente_id,r.cedente_fundo_id,v_nf_id,'nota_fiscal_salva_como_rascunho','operacao',v_actor,
      coalesce((SELECT nome_completo FROM public.profiles WHERE id=v_actor),'Entrada de documentos por e-mail'),
      coalesce((SELECT role::text FROM public.profiles WHERE id=v_actor),'sistema'),'fiscal_intake',
      CASE WHEN r.source_channel='EMAIL_INTAKE' THEN 'Nota fiscal recebida por e-mail.' ELSE 'Nota fiscal cadastrada por upload.' END,
      v_metadata,'ambos','fiscal_identity_reservations',r.id::text);
  UPDATE private.fiscal_storage_intents SET state='RETAINED',updated_at=clock_timestamp() WHERE id=o.id;
  UPDATE private.fiscal_identity_reservations SET state='COMPLETED',nota_fiscal_id=v_nf_id,updated_at=clock_timestamp() WHERE id=r.id;
  IF r.attachment_id IS NOT NULL THEN
    UPDATE private.email_intake_attachments SET status='IMPORTED',nota_fiscal_id=v_nf_id,sha256=r.file_sha256,
      completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL WHERE id=r.attachment_id AND lease_token=r.attachment_token;
    IF NOT FOUND THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST'; END IF;
  END IF;
  DELETE FROM private.fiscal_prepared_imports WHERE reservation_id=r.id;
  RETURN jsonb_build_object('nfId',v_nf_id,'numero',n.numero_nf);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconciliar_base_nf_apos_vinculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.nota_fiscal_id IS NOT NULL
     AND NEW.documento_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.documento_id IS DISTINCT FROM OLD.documento_id) THEN
    IF EXISTS (
      SELECT 1
      FROM public.notas_fiscais nf
      JOIN private.fiscal_identity_reservations r ON r.id = nf.fiscal_reservation_id
        AND r.fundo_id = nf.fundo_id AND r.cedente_id = nf.cedente_id
        AND r.cedente_fundo_id = nf.cedente_fundo_id AND r.estabelecimento_id = nf.estabelecimento_id
      JOIN private.fiscal_prepared_imports s ON s.reservation_id = r.id
        AND s.generation = r.generation AND s.owner_token = r.owner_token
      JOIN private.fiscal_storage_intents o ON o.id = s.storage_intent_id
        AND o.reservation_id = r.id AND o.generation = r.generation AND o.owner_token = r.owner_token
      JOIN public.documentos_repositorio d ON d.id = NEW.documento_id AND d.fiscal_reservation_id = r.id
      WHERE nf.id = NEW.nota_fiscal_id AND nf.status::text = 'rascunho'
        AND r.state = 'RESERVED' AND o.state IN ('PLANNED', 'STORED')
    ) THEN
      RETURN NEW;
    END IF;
    IF EXISTS(SELECT 1 FROM private.fiscal_document_claims c JOIN private.fiscal_storage_intents o ON o.id=c.storage_intent_id
      JOIN public.documentos_repositorio d ON d.id=NEW.documento_id AND d.fiscal_reservation_id=c.reservation_id
      WHERE c.nota_fiscal_id=NEW.nota_fiscal_id AND c.state='RESERVED' AND c.lease_expires_at>clock_timestamp() AND o.state IN('PLANNED','STORED')) THEN RETURN NEW; END IF;
    PERFORM public.reconciliar_documentos_base_nf(NEW.nota_fiscal_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.fiscal_guard_storage_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o private.fiscal_storage_intents%ROWTYPE; r private.fiscal_identity_reservations%ROWTYPE;
BEGIN
  SELECT * INTO o FROM private.fiscal_storage_intents WHERE bucket=NEW.bucket_id AND path=NEW.name;
  IF o.id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=o.reservation_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.document_type||':'||r.identity_sha256,0));
  SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=o.reservation_id FOR SHARE;
  SELECT * INTO o FROM private.fiscal_storage_intents WHERE id=o.id;
  IF EXISTS(SELECT 1 FROM private.fiscal_document_claims c WHERE c.reservation_id=r.id AND c.storage_intent_id=o.id AND c.owner_token=o.owner_token AND c.generation=o.generation) THEN
    PERFORM private.fiscal_assert_document_nf((SELECT c.nota_fiscal_id FROM private.fiscal_document_claims c WHERE c.storage_intent_id=o.id),r.id,o.owner_token,o.generation);
    IF o.state NOT IN('PLANNED','STORED') THEN RAISE EXCEPTION 'FISCAL_STORAGE_FENCE_LOST' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END IF;
  IF r.state<>'RESERVED' OR r.lease_expires_at<=clock_timestamp() OR r.generation<>o.generation
    OR r.owner_token<>o.owner_token OR o.state NOT IN ('PLANNED','STORED')
    THEN RAISE EXCEPTION 'FISCAL_STORAGE_FENCE_LOST' USING ERRCODE='42501'; END IF;
  PERFORM private.fiscal_validate_stored_actor(r);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_intake_reconcile_expired(p_limit integer DEFAULT 20)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.fiscal_identity_reservations%ROWTYPE; v_count integer:=0; doc record;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'FISCAL_LIMIT_INVALID' USING ERRCODE='22023'; END IF;
  FOR r IN SELECT r0.* FROM private.fiscal_identity_reservations r0
    LEFT JOIN public.nfse_review_intents v ON v.id=r0.review_intent_id
    WHERE (r0.state='RESERVED' AND r0.lease_expires_at<=clock_timestamp())
      OR (r0.state='REQUIRES_REVIEW' AND v.expires_at<=clock_timestamp())
    ORDER BY r0.updated_at,r0.id LIMIT p_limit
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(r.document_type||':'||r.identity_sha256,0)) THEN CONTINUE; END IF;
    SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=r.id FOR UPDATE;
    IF (r.state='RESERVED' AND r.lease_expires_at<=clock_timestamp()) OR
      (r.state='REQUIRES_REVIEW' AND EXISTS(SELECT 1 FROM public.nfse_review_intents v WHERE v.id=r.review_intent_id AND v.expires_at<=clock_timestamp())) THEN
      PERFORM public.fiscal_intake_abort(r.id,r.owner_token,r.generation);
      v_count:=v_count+1;
    END IF;
  END LOOP;
  FOR doc IN SELECT c.id,c.owner_token,c.generation,canonical.identity_sha256 FROM private.fiscal_document_claims c JOIN private.fiscal_identity_reservations canonical ON canonical.id=c.reservation_id
    WHERE c.state='RESERVED' AND c.lease_expires_at<=clock_timestamp() ORDER BY c.lease_expires_at,c.id LIMIT p_limit LOOP
    IF pg_try_advisory_xact_lock(hashtextextended('NFE:'||doc.identity_sha256,0)) THEN
      PERFORM public.fiscal_intake_abort_companion(doc.id,doc.owner_token,doc.generation);v_count:=v_count+1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_operator_inbox(p_fundo uuid,p_filter jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; page_no integer:=coalesce((p_filter->>'page')::integer,1); page_size integer:=coalesce((p_filter->>'pageSize')::integer,25);
 v_id uuid:=(p_filter->>'integrationId')::uuid; v_cedente uuid:=(p_filter->>'cedenteId')::uuid;
 v_since timestamptz:=(p_filter->>'since')::timestamptz; v_until timestamptz:=(p_filter->>'until')::timestamptz; v_status text:=coalesce(p_filter->>'status','ALL');
BEGIN
 IF NOT private.email_operator_allowed(p_fundo) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF page_no<1 OR page_no>100000 OR page_size NOT IN(25,50) OR v_status NOT IN('ALL','REVIEW','ERROR','IMPORTED','DUPLICATE')
  OR (v_since IS NOT NULL AND v_until IS NOT NULL AND v_since>v_until) OR length(coalesce(p_filter->>'errorCode',''))>80 THEN RAISE EXCEPTION 'EMAIL_INVALID_FILTER'; END IF;
 IF v_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.email_integrations WHERE id=v_id AND fundo_id=p_fundo) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 WITH messages AS(
 SELECT m.id,m.received_at,m.subject_preview,m.sender_masked,m.discovery_source,i.name integration_name,i.provider,i.id integration_id,
  count(a.id)::integer attachment_count,count(a.id) FILTER(WHERE a.status='IMPORTED')::integer imported,
  count(a.id) FILTER(WHERE a.status='DUPLICATE')::integer duplicates,
  count(a.id) FILTER(WHERE a.status='COMPANION_LINKED')::integer companions,
  coalesce(array_agg(DISTINCT CASE WHEN a.document_code='nf_xml' OR lower(a.file_name) LIKE '%.xml' THEN 'XML'
    WHEN a.document_code='nf_danfe_pdf' THEN 'DANFE' WHEN lower(a.file_name) LIKE '%.pdf' THEN 'PDF' ELSE 'OUTRO' END) FILTER(WHERE a.id IS NOT NULL),'{}'::text[]) attachment_types,
  count(a.id) FILTER(WHERE a.status='REQUIRES_REVIEW')::integer review,
  count(a.id) FILTER(WHERE a.status IN('QUARANTINED','REJECTED','FAILED','CLEANUP_PENDING'))::integer errors,
  count(a.id) FILTER(WHERE a.status IN('PENDING','PROCESSING','RETRY'))::integer pending
 FROM private.email_integrations i JOIN private.email_intake_messages m ON m.integration_id=i.id
 LEFT JOIN private.email_intake_attachments a ON a.message_id=m.id
 WHERE i.fundo_id=p_fundo AND (v_id IS NULL OR i.id=v_id) AND (v_since IS NULL OR m.received_at>=v_since) AND (v_until IS NULL OR m.received_at<=v_until)
  AND (v_cedente IS NULL OR EXISTS(SELECT 1 FROM private.email_attachment_operator x WHERE x.message_id=m.id AND x.cedente_id=v_cedente))
  AND (nullif(p_filter->>'errorCode','') IS NULL OR EXISTS(SELECT 1 FROM private.email_intake_attachments x WHERE x.message_id=m.id AND x.last_error_code=p_filter->>'errorCode'))
  AND (nullif(p_filter->>'documentType','') IS NULL OR EXISTS(SELECT 1 FROM private.email_attachment_operator x WHERE x.message_id=m.id AND x.document_type=p_filter->>'documentType'))
 GROUP BY m.id,i.id), filtered AS(
 SELECT * FROM messages m WHERE (v_status='ALL' OR (v_status='REVIEW' AND review>0) OR (v_status='ERROR' AND errors>0)
  OR (v_status='IMPORTED' AND imported>0) OR (v_status='DUPLICATE' AND duplicates>0))
  AND (NOT coalesce((p_filter->>'reviewOnly')::boolean,false) OR EXISTS(SELECT 1 FROM private.email_attachment_operator x WHERE x.message_id=m.id AND x.review_available))),
 paged AS(SELECT * FROM filtered ORDER BY received_at DESC,id DESC LIMIT page_size OFFSET (page_no-1)*page_size)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'page',page_no,'pageSize',page_size,
  'rows',coalesce(jsonb_agg(to_jsonb(paged) ORDER BY received_at DESC,id DESC),'[]'::jsonb)) INTO result FROM paged;
 RETURN result;
END $$;
COMMIT;
