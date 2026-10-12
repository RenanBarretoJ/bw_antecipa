BEGIN;
-- Fiscal values are staged by the trusted parser service, never accepted from a
-- browser in the commit RPC. The authenticated commit still checks human RLS
-- domain equivalents, session/MFA, scope and fence using the real JWT.
CREATE TABLE private.fiscal_prepared_imports (
  reservation_id uuid PRIMARY KEY REFERENCES private.fiscal_identity_reservations(id),
  generation bigint NOT NULL,
  owner_token uuid NOT NULL,
  values_json jsonb NOT NULL CHECK (jsonb_typeof(values_json) = 'object'),
  parcelas jsonb NOT NULL CHECK (jsonb_typeof(parcelas) = 'array'),
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','application/xml','text/xml')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
  document_code text NOT NULL CHECK (document_code IN ('nf_xml','nf_danfe_pdf')),
  politica_id uuid REFERENCES public.politicas_operacionais(id),
  politica_versao_id uuid REFERENCES public.politica_operacional_versoes(id),
  document_type_id uuid REFERENCES public.documento_tipos(id),
  storage_intent_id uuid REFERENCES private.fiscal_storage_intents(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.fiscal_prepared_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.fiscal_prepared_imports FROM PUBLIC,anon,authenticated,service_role;

-- Explicit-user variant of the canonical Cedente access helper. The old helper
-- remains a wrapper around auth.uid(); no identity is installed or impersonated.
CREATE FUNCTION private.cedente_usuario_tem_acesso(p_user_id uuid,p_cedente_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.cedente_acessos ca WHERE ca.user_id=p_user_id AND ca.cedente_id=p_cedente_id AND ca.status='ATIVO')
    OR EXISTS (SELECT 1 FROM public.cedentes c WHERE c.id=p_cedente_id AND c.user_id=p_user_id
      AND NOT EXISTS (SELECT 1 FROM public.cedente_acessos ca WHERE ca.user_id=p_user_id AND ca.cedente_id=p_cedente_id))
  );
$$;
CREATE OR REPLACE FUNCTION private.usuario_tem_acesso_cedente(p_cedente_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.cedente_usuario_tem_acesso((SELECT auth.uid()),p_cedente_id);
$$;
REVOKE ALL ON FUNCTION private.cedente_usuario_tem_acesso(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Infrastructure writes validate the persisted real actor, including session
-- revocation. This never installs a human JWT in a technical connection.
CREATE FUNCTION private.fiscal_validate_stored_actor(r private.fiscal_identity_reservations)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text;
BEGIN
  IF NOT private.estabelecimento_pode_originar(r.estabelecimento_id,r.cedente_id,r.fundo_id)
    THEN RAISE EXCEPTION 'FISCAL_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  IF r.source_channel='EMAIL_INTAKE' THEN
    PERFORM private.fiscal_validate_email_claim(jsonb_build_object('integrationId',r.integration_id,'messageId',r.message_id,
      'attachmentId',r.attachment_id,'attachmentToken',r.attachment_token),r.fundo_id,r.cedente_id);
  END IF;
  IF r.actor_type='SYSTEM' THEN RETURN; END IF;
  SELECT role::text INTO v_role FROM public.profiles WHERE id=r.actor_user_id AND status::text='ativo';
  IF v_role IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions s JOIN public.sessoes_elevadas e ON e.session_id=s.id AND e.user_id=s.user_id
    JOIN auth.mfa_factors f ON f.id::text=e.factor_id AND f.user_id=s.user_id AND f.status='verified'
    WHERE s.id=r.actor_session_id AND s.user_id=r.actor_user_id AND s.aal='aal2'
      AND (s.not_after IS NULL OR s.not_after>clock_timestamp()) AND e.revogada_em IS NULL
      AND e.expira_em>clock_timestamp() AND e.metodo='totp'
  ) THEN RAISE EXCEPTION 'FISCAL_ACTOR_DENIED' USING ERRCODE='42501'; END IF;
  IF NOT coalesce(CASE v_role
    WHEN 'cedente' THEN private.cedente_usuario_tem_acesso(r.actor_user_id,r.cedente_id)
    WHEN 'consultor' THEN private.consultor_usuario_pode_operar_cedente(r.actor_user_id,r.cedente_id)
      AND private.consultor_usuario_tem_acesso_fundo(r.actor_user_id,r.fundo_id)
    WHEN 'gestor' THEN EXISTS (SELECT 1 FROM public.usuario_fundos uf WHERE uf.usuario_id=r.actor_user_id AND uf.fundo_id=r.fundo_id AND uf.status='ativo')
    ELSE false END,false) THEN RAISE EXCEPTION 'FISCAL_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_validate_stored_actor(private.fiscal_identity_reservations) FROM PUBLIC,anon,authenticated,service_role;

-- The seal is infrastructure attestation. It does not grant NF write authority.
CREATE FUNCTION public.fiscal_intake_stage(
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
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR p_values->>'chave_acesso' IS NULL
    OR encode(extensions.digest(p_values->>'chave_acesso','sha256'),'hex') IS DISTINCT FROM r.identity_sha256
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
REVOKE ALL ON FUNCTION public.fiscal_intake_stage(uuid,uuid,bigint,jsonb,jsonb,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_stage(uuid,uuid,bigint,jsonb,jsonb,text,text,bigint,text) TO service_role;

-- Recovery is restricted to an incomplete legacy draft. Operational history,
-- document versions and completed imports are never replaced by a retry.
CREATE FUNCTION private.fiscal_can_recover_xml(p_nf_id uuid,p_cedente_id uuid,p_cf_id uuid,p_fundo_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.notas_fiscais n WHERE n.id=p_nf_id AND n.status='rascunho'
    AND n.cedente_id=p_cedente_id AND n.cedente_fundo_id=p_cf_id AND n.fundo_id=p_fundo_id
    AND n.fiscal_reservation_id IS NULL AND coalesce(n.tipo_documento_fiscal,'NFE')='NFE'
    AND NOT (coalesce(lower(n.arquivo_url) LIKE '%.xml',false) AND EXISTS (
      SELECT 1 FROM storage.objects o WHERE o.bucket_id='notas-fiscais' AND o.name=n.arquivo_url))
    AND NOT EXISTS (SELECT 1 FROM public.operacoes_nfs WHERE nota_fiscal_id=n.id)
    AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_entregas WHERE nota_fiscal_id=n.id)
    AND NOT EXISTS (SELECT 1 FROM public.operacao_calculo_nfs WHERE nota_fiscal_id=n.id)
    AND NOT EXISTS (SELECT 1 FROM public.operacao_nf_logistica_memorias WHERE nota_fiscal_id=n.id)
    AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_entrega_postergacoes_canhoto WHERE nota_fiscal_id=n.id)
    AND NOT EXISTS (SELECT 1 FROM public.documento_requisito_instancias i JOIN public.documento_versoes v ON v.documento_id=i.documento_id WHERE i.nota_fiscal_id=n.id)
    AND NOT EXISTS (SELECT 1 FROM public.documento_vinculos d JOIN public.documento_versoes v ON v.documento_id=d.documento_id WHERE d.nota_fiscal_id=n.id));
$$;
REVOKE ALL ON FUNCTION private.fiscal_can_recover_xml(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fiscal_intake_prepare_storage(p_id uuid,p_token uuid,p_generation bigint)
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
  IF v_required THEN
    SELECT * INTO v_type FROM public.documento_tipos WHERE codigo=s.document_code AND ativo;
    IF v_type.id IS NULL OR s.size_bytes>v_type.tamanho_max_bytes OR NOT (s.mime_type=ANY(v_type.mime_types_aceitos))
      THEN RAISE EXCEPTION 'FISCAL_DOCUMENT_INVALID'; END IF;
  END IF;
  v_intent := public.fiscal_intake_plan_storage(p_id,p_token,p_generation,
    CASE WHEN v_required THEN 'documentos-v2' ELSE 'notas-fiscais' END,CASE WHEN s.document_code='nf_xml' THEN 'xml' ELSE 'pdf' END);
  UPDATE private.fiscal_prepared_imports SET politica_id=v_policy,politica_versao_id=v_version,document_type_id=v_type.id,
    storage_intent_id=(v_intent->>'id')::uuid WHERE reservation_id=p_id;
  RETURN v_intent;
END;
$$;

CREATE FUNCTION public.fiscal_intake_commit(p_id uuid,p_token uuid,p_generation bigint,p_storage_intent_id uuid)
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
    IF v_req IS NULL THEN RAISE EXCEPTION 'FISCAL_DOCUMENT_REQUIREMENT_CHANGED'; END IF;
    PERFORM private.fiscal_registrar_documento_upload(v_nf_id,v_req,s.document_type_id,s.file_name,s.mime_type,s.size_bytes,
      o.sha256,o.bucket,o.path,v_actor,NULL,p_id,p_token,p_generation);
    PERFORM private.fiscal_reconciliar_documentos_base_nf(v_nf_id,p_id,p_token,p_generation);
  END IF;
  v_metadata := jsonb_build_object('actor_type',r.actor_type,'actor_source',CASE WHEN r.actor_type='SYSTEM' THEN 'EMAIL_INTAKE' ELSE 'APP' END,
    'source_channel',r.source_channel,'fiscal_reservation_id',r.id,'integration_id',r.integration_id,'message_id',r.message_id,
    'attachment_id',r.attachment_id,'parser_strategy',n.fiscal_proveniencia->>'strategy','outcome','IMPORTED',
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
REVOKE ALL ON FUNCTION public.fiscal_intake_prepare_storage(uuid,uuid,bigint),public.fiscal_intake_commit(uuid,uuid,bigint,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_prepare_storage(uuid,uuid,bigint),public.fiscal_intake_commit(uuid,uuid,bigint,uuid) TO authenticated,service_role;

-- Resolve the canonical original only after the server action authorizes the NF.
CREATE FUNCTION public.fiscal_intake_get_original(p_nf_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('bucket',o.bucket,'path',o.path)
    FROM public.notas_fiscais n JOIN private.fiscal_identity_reservations r ON r.id=n.fiscal_reservation_id AND r.nota_fiscal_id=n.id
    JOIN private.fiscal_storage_intents o ON o.reservation_id=r.id AND o.generation=r.generation AND o.owner_token=r.owner_token
    WHERE n.id=p_nf_id AND r.state='COMPLETED' AND o.state='RETAINED' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.fiscal_intake_get_original(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_get_original(uuid) TO service_role;
-- Server-only recovery handles a lost commit response before scheduling deletion.
CREATE FUNCTION public.fiscal_intake_abort(p_id uuid,p_token uuid,p_generation bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.fiscal_identity_reservations%ROWTYPE; v_state text;
BEGIN
  SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=p_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.document_type||':'||r.identity_sha256,0));
  SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=p_id FOR UPDATE;
  IF r.owner_token IS DISTINCT FROM p_token OR r.generation IS DISTINCT FROM p_generation
    THEN RAISE EXCEPTION 'FISCAL_LEASE_LOST'; END IF;
  IF r.state='COMPLETED' THEN
    RETURN jsonb_build_object('status','IMPORTED','nfId',r.nota_fiscal_id,
      'numero',(SELECT numero_nf FROM public.notas_fiscais WHERE id=r.nota_fiscal_id));
  END IF;
  IF r.nota_fiscal_id IS NOT NULL THEN RAISE EXCEPTION 'FISCAL_RECONCILIATION_REQUIRED'; END IF;
  UPDATE private.fiscal_storage_intents SET state='DELETE_PENDING',updated_at=clock_timestamp()
    WHERE reservation_id=p_id AND generation=p_generation AND state NOT IN ('DELETED','RETAINED');
  v_state := CASE WHEN EXISTS (SELECT 1 FROM private.fiscal_storage_intents WHERE reservation_id=p_id AND generation=p_generation AND state<>'DELETED')
    THEN 'CLEANUP_PENDING' ELSE 'RELEASED' END;
  UPDATE private.fiscal_identity_reservations SET state=v_state,updated_at=clock_timestamp() WHERE id=p_id;
  RETURN jsonb_build_object('status',CASE WHEN v_state='RELEASED' THEN 'FAILED' ELSE v_state END);
END;
$$;

-- Storage API finalizes objects in this same PostgreSQL database. This prevents
-- a delayed request from resurrecting a path after cleanup/release/takeover.
CREATE FUNCTION private.fiscal_guard_storage_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o private.fiscal_storage_intents%ROWTYPE; r private.fiscal_identity_reservations%ROWTYPE;
BEGIN
  SELECT * INTO o FROM private.fiscal_storage_intents WHERE bucket=NEW.bucket_id AND path=NEW.name;
  IF o.id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=o.reservation_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.document_type||':'||r.identity_sha256,0));
  SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=o.reservation_id FOR SHARE;
  SELECT * INTO o FROM private.fiscal_storage_intents WHERE id=o.id;
  IF r.state<>'RESERVED' OR r.lease_expires_at<=clock_timestamp() OR r.generation<>o.generation
    OR r.owner_token<>o.owner_token OR o.state NOT IN ('PLANNED','STORED')
    THEN RAISE EXCEPTION 'FISCAL_STORAGE_FENCE_LOST' USING ERRCODE='42501'; END IF;
  PERFORM private.fiscal_validate_stored_actor(r);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_guard_storage_insert() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER fiscal_guard_storage_insert BEFORE INSERT OR UPDATE OF bucket_id,name,metadata ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION private.fiscal_guard_storage_insert();

CREATE FUNCTION public.fiscal_intake_claim_cleanup(p_reservation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o private.fiscal_storage_intents%ROWTYPE;
BEGIN
  SELECT * INTO o FROM private.fiscal_storage_intents WHERE state='DELETE_PENDING' AND retry_at<=clock_timestamp()
    AND (p_reservation_id IS NULL OR reservation_id=p_reservation_id)
    AND (cleanup_expires_at IS NULL OR cleanup_expires_at<=clock_timestamp()) ORDER BY retry_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF o.id IS NULL THEN RETURN NULL; END IF;
  UPDATE private.fiscal_storage_intents SET cleanup_token=gen_random_uuid(),cleanup_expires_at=clock_timestamp()+interval '2 minutes',
    attempts=attempts+1,updated_at=clock_timestamp() WHERE id=o.id RETURNING * INTO o;
  RETURN jsonb_build_object('id',o.id,'token',o.cleanup_token,'bucket',o.bucket,'path',o.path,'sha256',o.sha256);
END;
$$;

CREATE FUNCTION public.fiscal_intake_settle_cleanup(p_id uuid,p_token uuid,p_deleted boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o private.fiscal_storage_intents%ROWTYPE; r private.fiscal_identity_reservations%ROWTYPE;
BEGIN
  SELECT * INTO o FROM private.fiscal_storage_intents WHERE id=p_id;
  SELECT * INTO r FROM private.fiscal_identity_reservations WHERE id=o.reservation_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'FISCAL_CLEANUP_LEASE_LOST'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.document_type||':'||r.identity_sha256,0));
  PERFORM 1 FROM private.fiscal_identity_reservations WHERE id=r.id FOR UPDATE;
  SELECT * INTO o FROM private.fiscal_storage_intents WHERE id=p_id FOR UPDATE;
  IF o.cleanup_token IS NULL OR p_token IS NULL OR o.cleanup_token IS DISTINCT FROM p_token OR o.cleanup_expires_at<=clock_timestamp() OR o.state<>'DELETE_PENDING'
    THEN RAISE EXCEPTION 'FISCAL_CLEANUP_LEASE_LOST'; END IF;
  IF p_deleted AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id=o.bucket AND name=o.path)
    THEN RAISE EXCEPTION 'FISCAL_CLEANUP_OBJECT_REMAINS'; END IF;
  UPDATE private.fiscal_storage_intents SET state=CASE WHEN p_deleted THEN 'DELETED' ELSE 'DELETE_PENDING' END,
    cleanup_token=NULL,cleanup_expires_at=NULL,retry_at=clock_timestamp()+least(attempts,60)*interval '1 minute',updated_at=clock_timestamp() WHERE id=p_id;
  IF p_deleted AND o.generation=r.generation AND NOT EXISTS (SELECT 1 FROM private.fiscal_storage_intents WHERE reservation_id=r.id AND generation=r.generation AND state<>'DELETED') THEN
    UPDATE private.fiscal_identity_reservations SET state='RELEASED',updated_at=clock_timestamp()
      WHERE id=r.id AND state='CLEANUP_PENDING' AND nota_fiscal_id IS NULL;
    DELETE FROM private.fiscal_prepared_imports WHERE reservation_id=r.id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fiscal_intake_abort(uuid,uuid,bigint),public.fiscal_intake_claim_cleanup(uuid),
  public.fiscal_intake_settle_cleanup(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_abort(uuid,uuid,bigint),public.fiscal_intake_claim_cleanup(uuid),
  public.fiscal_intake_settle_cleanup(uuid,uuid,boolean) TO service_role;

-- A legitimately deleted draft can be imported again. Retained historical
-- document versions keep their own lifecycle; a new generation never owns them.
CREATE FUNCTION private.fiscal_release_deleted_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE private.fiscal_storage_intents o SET state='DELETE_PENDING',retry_at=clock_timestamp(),updated_at=clock_timestamp()
    FROM private.fiscal_identity_reservations r WHERE r.id=OLD.fiscal_reservation_id AND o.reservation_id=r.id
      AND o.generation=r.generation AND o.state<>'DELETED';
  UPDATE private.fiscal_identity_reservations SET state='CLEANUP_PENDING',nota_fiscal_id=NULL,updated_at=clock_timestamp()
    WHERE id=OLD.fiscal_reservation_id AND state='COMPLETED';
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_release_deleted_draft() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER fiscal_release_deleted_draft AFTER DELETE ON public.notas_fiscais
  FOR EACH ROW WHEN (OLD.fiscal_reservation_id IS NOT NULL) EXECUTE FUNCTION private.fiscal_release_deleted_draft();
COMMIT;
