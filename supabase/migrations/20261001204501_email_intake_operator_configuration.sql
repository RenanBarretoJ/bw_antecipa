BEGIN;

-- Extend the existing credential vault; no copied mailbox secrets or new vault.
ALTER TABLE public.credenciais_integracao DROP CONSTRAINT credenciais_type_check,
 DROP CONSTRAINT credenciais_capabilities_check,
 ADD CONSTRAINT credenciais_type_check CHECK (credential_type IN ('usuario_senha','oauth_client_credentials')),
 ADD CONSTRAINT credenciais_capabilities_check CHECK (capabilities <@ ARRAY['CESSAO_ENVIO','ESTOQUE','AQUISICOES','LIQUIDACOES','CARTEIRA','EMAIL_INTAKE']::text[] AND array_position(capabilities,NULL) IS NULL),
 ADD CONSTRAINT credenciais_email_type_check CHECK (credential_type<>'oauth_client_credentials' OR
   (provider_key='OUTLOOK_GRAPH' AND capabilities=ARRAY['EMAIL_INTAKE']::text[] AND integracao_fundo_id IS NULL));

ALTER TABLE private.email_integrations
 ADD COLUMN create_request_id uuid,
 ADD COLUMN credential_id uuid REFERENCES public.credenciais_integracao(id),
 ADD COLUMN environment text NOT NULL DEFAULT 'homologacao' CHECK(environment IN ('homologacao','producao')),
 ADD COLUMN config_status text NOT NULL DEFAULT 'DRAFT' CHECK(config_status IN ('DRAFT','ACTIVE','DISABLED','ERROR')),
 ADD COLUMN config_revision bigint NOT NULL DEFAULT 1,
 ADD COLUMN mailbox_object_id uuid,
 ADD COLUMN test_token uuid,
 ADD COLUMN test_revision bigint,
 ADD COLUMN test_started_at timestamptz,
 ADD COLUMN test_completed_at timestamptz,
 ADD COLUMN test_error_code text,
 ADD COLUMN tested_tenant_id uuid,
 ALTER COLUMN mailbox_address DROP NOT NULL,
 ALTER COLUMN start_at DROP NOT NULL;
UPDATE private.email_integrations SET config_status=CASE WHEN enabled THEN 'ACTIVE' ELSE 'DISABLED' END;
UPDATE private.email_integrations i SET mailbox_object_id=a.mailbox_object_id
 FROM private.email_automation a WHERE a.integration_id=i.id;
CREATE INDEX email_integrations_credential_idx ON private.email_integrations(credential_id) WHERE credential_id IS NOT NULL;
CREATE UNIQUE INDEX email_integrations_create_request_idx ON private.email_integrations(fundo_id,created_by,create_request_id) WHERE create_request_id IS NOT NULL;
CREATE UNIQUE INDEX email_credentials_create_request_idx ON public.credenciais_integracao(fundo_id,criada_por,(metadados->>'email_request_id')) WHERE credential_type='oauth_client_credentials';

-- Replace only the legacy enabled/credential check; legacy QA env/scoped ciphertext still work.
DO $$ DECLARE n text; matches integer:=0; BEGIN
 FOR n IN SELECT conname FROM pg_constraint WHERE conrelid='private.email_integrations'::regclass
   AND contype='c' AND pg_get_constraintdef(oid) LIKE '%NOT enabled%' LOOP
   EXECUTE format('ALTER TABLE private.email_integrations DROP CONSTRAINT %I',n); matches:=matches+1;
 END LOOP;
 IF matches<>1 THEN RAISE EXCEPTION 'EMAIL_ENABLED_CONSTRAINT_DRIFT'; END IF;
END $$;
ALTER TABLE private.email_integrations ADD CONSTRAINT email_integration_ready CHECK(NOT enabled OR
 (provider='OUTLOOK_GRAPH' AND mailbox_address IS NOT NULL AND start_at IS NOT NULL AND scope_verified_at IS NOT NULL
  AND scope_evidence_hash IS NOT NULL AND (credential_id IS NOT NULL OR credential_ciphertext IS NOT NULL OR credential_env_ref IS NOT NULL))),
 ADD CONSTRAINT email_credential_single_source CHECK(credential_id IS NULL OR (credential_ciphertext IS NULL AND credential_env_ref IS NULL));

CREATE FUNCTION private.email_configuration_allowed(p_fundo uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.email_operator_allowed(p_fundo) AND EXISTS(
 SELECT 1 FROM jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) x
 WHERE x->>'method'='totp' AND (x->>'timestamp')::numeric>=extract(epoch FROM now())-300);
$$;
REVOKE ALL ON FUNCTION private.email_configuration_allowed(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.email_credential_compatible(p_credential uuid,p_fundo uuid,p_environment text) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.credenciais_integracao c WHERE c.id=p_credential AND c.fundo_id=p_fundo
  AND c.provider_key='OUTLOOK_GRAPH' AND c.credential_type='oauth_client_credentials'
  AND c.ambiente=p_environment AND c.status='ativa' AND c.revogada_em IS NULL
  AND c.capabilities @> ARRAY['EMAIL_INTAKE']::text[] AND c.integracao_fundo_id IS NULL);
$$;
REVOKE ALL ON FUNCTION private.email_credential_compatible(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.email_config_audit(p_event text,p_id uuid,p_fundo uuid,p_before jsonb,p_after jsonb) RETURNS void
LANGUAGE sql SET search_path='' AS $$
 INSERT INTO public.logs_auditoria(usuario_id,tipo_evento,entidade_tipo,entidade_id,dados_antes,dados_depois)
 VALUES(auth.uid(),p_event,'email_integrations',p_id,p_before,coalesce(p_after,'{}'::jsonb)||jsonb_build_object('fundo_id',p_fundo));
$$;
REVOKE ALL ON FUNCTION private.email_config_audit(text,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.email_operator_create_credential(p_fundo uuid,p_name text,p_environment text,
 p_identity_cipher text,p_secret_cipher text,p_key_version text,p_request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT private.email_configuration_allowed(p_fundo) OR NOT private.usuario_e_super_admin() THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL THEN RAISE EXCEPTION 'EMAIL_INVALID_CONFIGURATION'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_fundo::text),hashtext(p_request::text));
 SELECT id INTO v_id FROM public.credenciais_integracao WHERE fundo_id=p_fundo AND criada_por=auth.uid() AND credential_type='oauth_client_credentials' AND metadados->>'email_request_id'=p_request::text;
 IF FOUND THEN RETURN v_id; END IF;
 IF length(trim(coalesce(p_name,''))) NOT BETWEEN 2 AND 120 OR p_environment IS NULL OR p_environment NOT IN ('homologacao','producao')
  OR coalesce(p_identity_cipher,'') !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
  OR coalesce(p_secret_cipher,'') !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
  OR length(coalesce(p_key_version,'')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'EMAIL_INVALID_CONFIGURATION'; END IF;
 INSERT INTO public.credenciais_integracao(fundo_id,integracao_fundo_id,ambiente,nome,provider_key,credential_type,
  capabilities,usuario_criptografado,senha_criptografada,chave_versao,status,criada_por,ativada_em,metadados)
 VALUES(p_fundo,NULL,p_environment,trim(p_name),'OUTLOOK_GRAPH','oauth_client_credentials',ARRAY['EMAIL_INTAKE'],
  p_identity_cipher,p_secret_cipher,p_key_version,'ativa',auth.uid(),now(),jsonb_build_object('email_request_id',p_request)) RETURNING id INTO v_id;
 PERFORM private.sa3_auditar('CREDENCIAL_CRIADA',p_fundo,'credenciais_integracao',v_id,NULL,
  jsonb_build_object('provider_key','OUTLOOK_GRAPH','ambiente',p_environment,'status','ativa'),NULL);
 RETURN v_id;
END $$;

CREATE FUNCTION public.email_operator_save(p_fundo uuid,p_id uuid,p_revision bigint,p_config jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old private.email_integrations; v_id uuid; credential uuid:=(p_config->>'credentialId')::uuid;
 v_object uuid:=(p_config->>'mailboxObjectId')::uuid; boundary timestamptz:=(p_config->>'startAt')::timestamptz;
 allowed uuid[]; c uuid; v_mode text:=p_config->>'routingMode'; v_environment text:=p_config->>'environment'; request uuid:=(p_config->>'requestId')::uuid;
BEGIN
 IF NOT private.email_configuration_allowed(p_fundo) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL THEN
  IF request IS NULL THEN RAISE EXCEPTION 'EMAIL_INVALID_CONFIGURATION'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_fundo::text),hashtext(request::text));
  SELECT id INTO v_id FROM private.email_integrations WHERE fundo_id=p_fundo AND created_by=auth.uid() AND create_request_id=request;
  IF FOUND THEN RETURN v_id; END IF;
 END IF;
 IF p_config IS NULL OR length(trim(coalesce(p_config->>'name',''))) NOT BETWEEN 2 AND 120
  OR (p_config->>'provider') IS DISTINCT FROM 'OUTLOOK_GRAPH' OR v_environment IS NULL OR v_environment NOT IN ('homologacao','producao')
  OR v_mode IS NULL OR v_mode NOT IN ('ALL_ACTIVE_CEDENTES','ALLOWLIST')
  OR length(coalesce(p_config->>'folderId','')) NOT BETWEEN 1 AND 1024
  OR (p_config->>'mailbox' IS NOT NULL AND (length(p_config->>'mailbox')>320 OR p_config->>'mailbox' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
  OR jsonb_typeof(p_config->'cedenteIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_config->'cedenteIds')>1000 THEN
   RAISE EXCEPTION 'EMAIL_INVALID_CONFIGURATION' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(array_agg(DISTINCT value::uuid),'{}') INTO allowed FROM jsonb_array_elements_text(p_config->'cedenteIds');
 FOREACH c IN ARRAY allowed LOOP
  IF NOT EXISTS(SELECT 1 FROM public.cedente_fundos cf JOIN public.cedentes ce ON ce.id=cf.cedente_id
    WHERE cf.fundo_id=p_fundo AND cf.cedente_id=c AND cf.status='ativo' AND ce.status='ativo') THEN RAISE EXCEPTION 'EMAIL_CEDENTE_DENIED'; END IF;
 END LOOP;
 IF credential IS NOT NULL AND NOT private.email_credential_compatible(credential,p_fundo,v_environment) THEN RAISE EXCEPTION 'EMAIL_CREDENTIAL_INCOMPATIBLE'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO old FROM private.email_integrations WHERE id=p_id AND fundo_id=p_fundo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF old.config_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'EMAIL_CONFIG_CONFLICT' USING ERRCODE='40001'; END IF;
  IF old.enabled THEN RAISE EXCEPTION 'EMAIL_PAUSE_BEFORE_EDIT'; END IF;
  IF EXISTS(SELECT 1 FROM private.email_automation WHERE integration_id=p_id AND lease_expires_at>now())
    OR EXISTS(SELECT 1 FROM private.email_intake_attachments a JOIN private.email_intake_messages m ON m.id=a.message_id WHERE m.integration_id=p_id AND a.status='PROCESSING') THEN RAISE EXCEPTION 'EMAIL_PROCESSING'; END IF;
  IF EXISTS(SELECT 1 FROM private.email_intake_messages WHERE integration_id=p_id) AND
    (boundary IS NULL OR boundary<old.start_at OR old.mailbox_address IS DISTINCT FROM p_config->>'mailbox'
     OR old.mailbox_object_id IS DISTINCT FROM v_object OR old.folder_id IS DISTINCT FROM p_config->>'folderId'
     OR old.environment IS DISTINCT FROM v_environment) THEN RAISE EXCEPTION 'EMAIL_HISTORY_IMMUTABLE'; END IF;
  v_id:=p_id;
  UPDATE private.email_integrations SET name=trim(p_config->>'name'),mailbox_address=p_config->>'mailbox',mailbox_object_id=v_object,
   folder_id=p_config->>'folderId',credential_id=credential,credential_env_ref=NULL,credential_ciphertext=NULL,credential_key_version=NULL,
   environment=v_environment,routing_mode=v_mode,start_at=boundary,scope_verified_at=NULL,scope_evidence_hash=NULL,
   config_status='DRAFT',config_revision=config_revision+1,test_token=NULL,test_completed_at=NULL,test_revision=NULL,
   test_error_code=NULL,tested_tenant_id=NULL,updated_at=now() WHERE id=v_id;
  PERFORM private.email_config_audit('EMAIL_INTEGRATION_UPDATED',v_id,p_fundo,NULL,jsonb_build_object('revision',p_revision+1));
  IF old.credential_id IS DISTINCT FROM credential THEN PERFORM private.email_config_audit('EMAIL_INTEGRATION_CREDENTIAL_CHANGED',v_id,p_fundo,jsonb_build_object('id',old.credential_id),jsonb_build_object('id',credential)); END IF;
  IF old.start_at IS DISTINCT FROM boundary THEN PERFORM private.email_config_audit('EMAIL_INTEGRATION_START_AT_CHANGED',v_id,p_fundo,jsonb_build_object('start_at',old.start_at),jsonb_build_object('start_at',boundary)); END IF;
 ELSE
  INSERT INTO private.email_integrations(fundo_id,name,provider,environment,mailbox_address,mailbox_object_id,folder_id,
    credential_id,routing_mode,start_at,created_by,create_request_id)
   VALUES(p_fundo,trim(p_config->>'name'),'OUTLOOK_GRAPH',v_environment,p_config->>'mailbox',v_object,p_config->>'folderId',credential,v_mode,boundary,auth.uid(),request) RETURNING id INTO v_id;
  PERFORM private.email_config_audit('EMAIL_INTEGRATION_CREATED',v_id,p_fundo,NULL,jsonb_build_object('config_status','DRAFT'));
 END IF;
 -- Keep previous allowlist rows and their audit history, toggling eligibility only.
 UPDATE private.email_integration_cedentes SET active=false WHERE integration_id=v_id;
 INSERT INTO private.email_integration_cedentes(integration_id,cedente_id,active,created_by)
 SELECT v_id,x,true,auth.uid() FROM unnest(allowed) x
 ON CONFLICT(integration_id,cedente_id) DO UPDATE SET active=true;
 PERFORM private.email_config_audit('EMAIL_INTEGRATION_ROUTING_CHANGED',v_id,p_fundo,jsonb_build_object('mode',old.routing_mode),jsonb_build_object('mode',v_mode,'cedente_ids',allowed));
 RETURN v_id;
END $$;

CREATE FUNCTION public.email_operator_begin_test(p_id uuid,p_revision bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.email_integrations; token uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO i FROM private.email_integrations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT private.email_configuration_allowed(i.fundo_id) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF i.config_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'EMAIL_CONFIG_CONFLICT' USING ERRCODE='40001'; END IF;
 IF NOT private.email_credential_compatible(i.credential_id,i.fundo_id,i.environment) OR i.mailbox_address IS NULL OR i.mailbox_object_id IS NULL THEN RAISE EXCEPTION 'EMAIL_CONFIGURATION_INCOMPLETE'; END IF;
 IF i.test_started_at>now()-interval '1 minute' THEN RAISE EXCEPTION 'EMAIL_TEST_COOLDOWN'; END IF;
 UPDATE private.email_integrations SET test_token=token,test_revision=config_revision,test_started_at=now(),test_completed_at=NULL,test_error_code=NULL WHERE id=p_id;
 RETURN token;
END $$;

-- Server-only credential resolution. Credentials remain authoritative and are never copied into an integration.
CREATE FUNCTION public.email_credential_material(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.email_integrations; c public.credenciais_integracao;
BEGIN
 SELECT * INTO i FROM private.email_integrations WHERE id=p_id;
 IF NOT FOUND OR NOT private.email_credential_compatible(i.credential_id,i.fundo_id,i.environment)
  OR NOT EXISTS(SELECT 1 FROM public.fundos WHERE id=i.fundo_id AND ativo) THEN RAISE EXCEPTION 'EMAIL_CREDENTIAL_UNAVAILABLE'; END IF;
 SELECT * INTO c FROM public.credenciais_integracao WHERE id=i.credential_id;
 RETURN jsonb_build_object('integrationId',i.id,'fundoId',i.fundo_id,'mailbox',i.mailbox_address,'objectId',i.mailbox_object_id,
  'folderId',i.folder_id,'identityCiphertext',c.usuario_criptografado,'secretCiphertext',c.senha_criptografada,'keyVersion',c.chave_versao);
END $$;

CREATE FUNCTION public.email_operator_complete_test(p_id uuid,p_token uuid,p_tenant uuid,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_error IS NOT NULL AND p_error NOT IN ('CONFIGURATION','AUTHENTICATION','ACCESS_DENIED','NOT_FOUND','THROTTLED','PROVIDER_UNAVAILABLE','INVALID_RESPONSE') THEN RAISE EXCEPTION 'EMAIL_INVALID_TEST_RESULT'; END IF;
 UPDATE private.email_integrations SET test_token=NULL,test_completed_at=now(),test_error_code=p_error,tested_tenant_id=CASE WHEN p_error IS NULL THEN p_tenant END,
  config_status=CASE WHEN enabled THEN config_status WHEN p_error IS NULL THEN 'DRAFT' ELSE 'ERROR' END
 WHERE id=p_id AND test_token=p_token AND test_revision=config_revision AND test_started_at>now()-interval '2 minutes';
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_TEST_EXPIRED'; END IF;
END $$;

CREATE FUNCTION public.email_operator_set_enabled(p_id uuid,p_revision bigint,p_enabled boolean,p_scope_confirmed boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i private.email_integrations;
BEGIN
 SELECT * INTO i FROM private.email_integrations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT private.email_configuration_allowed(i.fundo_id) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF i.config_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'EMAIL_CONFIG_CONFLICT' USING ERRCODE='40001'; END IF;
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'EMAIL_INVALID_CONFIGURATION'; END IF;
 IF i.enabled=p_enabled THEN RETURN; END IF;
 IF p_enabled THEN
  IF p_scope_confirmed IS DISTINCT FROM true OR i.test_completed_at IS NULL OR i.test_completed_at<now()-interval '30 minutes'
   OR i.test_error_code IS NOT NULL OR i.test_revision IS DISTINCT FROM i.config_revision OR i.tested_tenant_id IS NULL
   OR i.mailbox_object_id IS NULL OR i.mailbox_address IS NULL OR i.start_at IS NULL OR i.start_at>now()
   OR NOT private.email_credential_compatible(i.credential_id,i.fundo_id,i.environment)
   OR (i.routing_mode='ALLOWLIST' AND NOT EXISTS(SELECT 1 FROM private.email_integration_cedentes a JOIN public.cedente_fundos cf ON cf.cedente_id=a.cedente_id AND cf.fundo_id=i.fundo_id AND cf.status='ativo' JOIN public.cedentes ce ON ce.id=a.cedente_id AND ce.status='ativo' WHERE a.integration_id=p_id AND a.active))
  THEN RAISE EXCEPTION 'EMAIL_ACTIVATION_INCOMPLETE'; END IF;
  INSERT INTO private.email_automation(integration_id,enabled,tenant_id,mailbox_object_id,subscription_resource,last_connection_success)
   VALUES(p_id,true,i.tested_tenant_id,i.mailbox_object_id,'users/'||i.mailbox_object_id||'/mailFolders/'||i.folder_id||'/messages',i.test_completed_at)
  ON CONFLICT(integration_id) DO UPDATE SET enabled=true,tenant_id=excluded.tenant_id,mailbox_object_id=excluded.mailbox_object_id,
   subscription_resource=excluded.subscription_resource,subscription_next_at=now(),last_connection_success=excluded.last_connection_success,health_checked_at=NULL;
  UPDATE private.email_integrations SET enabled=true,config_status='ACTIVE',scope_verified_at=now(),
   scope_evidence_hash=encode(extensions.digest('actor:'||auth.uid()||':revision:'||i.config_revision,'sha256'),'hex'),updated_at=now() WHERE id=p_id;
 ELSE
  UPDATE private.email_integrations SET enabled=false,config_status='DISABLED',updated_at=now() WHERE id=p_id;
  UPDATE private.email_automation SET enabled=false,health_status='DISABLED',health_checked_at=now() WHERE integration_id=p_id;
 END IF;
 PERFORM private.email_config_audit(CASE WHEN p_enabled THEN 'EMAIL_INTEGRATION_ENABLED' ELSE 'EMAIL_INTEGRATION_DISABLED' END,p_id,i.fundo_id,
  jsonb_build_object('enabled',i.enabled),jsonb_build_object('enabled',p_enabled));
END $$;

-- Revocation prevents new jobs immediately. Existing claims retain the certified finalization semantics.
CREATE FUNCTION private.email_credential_revoked() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.status IN ('revogada','substituida') AND OLD.status IS DISTINCT FROM NEW.status THEN
  UPDATE private.email_integrations SET enabled=false,config_status='DISABLED',test_completed_at=NULL,updated_at=now() WHERE credential_id=NEW.id;
  UPDATE private.email_automation SET enabled=false,health_status='DISABLED' WHERE integration_id IN(SELECT id FROM private.email_integrations WHERE credential_id=NEW.id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.email_credential_revoked() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER email_credential_revoked AFTER UPDATE OF status ON public.credenciais_integracao FOR EACH ROW EXECUTE FUNCTION private.email_credential_revoked();

REVOKE ALL ON FUNCTION public.email_operator_create_credential(uuid,text,text,text,text,text,uuid),public.email_operator_save(uuid,uuid,bigint,jsonb),
 public.email_operator_begin_test(uuid,bigint),public.email_operator_set_enabled(uuid,bigint,boolean,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.email_operator_create_credential(uuid,text,text,text,text,text,uuid),public.email_operator_save(uuid,uuid,bigint,jsonb),
 public.email_operator_begin_test(uuid,bigint),public.email_operator_set_enabled(uuid,bigint,boolean,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.email_credential_material(uuid),public.email_operator_complete_test(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_credential_material(uuid),public.email_operator_complete_test(uuid,uuid,uuid,text) TO service_role;
COMMIT;
