-- Somente banco LOCAL de rehearsal. Fixtures sinteticas e rollback integral.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'integration_credential_%' AND NOT (current_database() ~ '^r19_integrations_[0-9]+_[0-9a-f]{8}$' AND current_setting('application_name')='r19_local_sql') AND NOT (current_database()='postgres' AND current_setting('application_name') ~ '^r110_inl_[0-9]{13}$') THEN RAISE EXCEPTION 'Somente rehearsal local dedicado'; END IF;
END $$;
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('ac000000-0000-4000-8000-000000000001','credential-qa@example.invalid','{"nome_completo":"QA"}');
-- Auth canonical initial state: cedente/ativo, QA, matching id/email, no security overrides.
-- Reuse the automatic profile unchanged. Test privilege is assigned below through
-- usuario_papeis (super_admin); no profile INSERT/DELETE/UPDATE or trigger bypass.
CREATE FUNCTION pg_temp.assert_integration_auth_profile(actual jsonb, expected jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $fixture_guard$
BEGIN
 IF jsonb_typeof(actual) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'QA_AUTH_PROFILE_CARDINALITY' USING ERRCODE='23514';
 END IF;
 IF jsonb_array_length(actual) <> 1 THEN
   RAISE EXCEPTION 'QA_AUTH_PROFILE_CARDINALITY' USING ERRCODE='23514';
 END IF;
 IF ((actual->0) - 'created_at' - 'updated_at') IS DISTINCT FROM expected
    OR actual->0->>'created_at' IS NULL OR actual->0->>'updated_at' IS NULL THEN
   RAISE EXCEPTION 'QA_AUTH_PROFILE_CANONICAL_DRIFT' USING ERRCODE='23514';
 END IF;
END;
$fixture_guard$;
DO $fixture$
DECLARE
 actual jsonb; candidate jsonb; field text; rejected boolean;
 expected jsonb := jsonb_build_object(
   'id','ac000000-0000-4000-8000-000000000001','email','credential-qa@example.invalid',
   'nome_completo','QA','role','cedente','status','ativo','telefone',NULL,
   'mfa_obrigatorio_override',NULL,'mfa_ativado_em',NULL,
   'ultima_autenticacao_forte_em',NULL,'mfa_reset_em',NULL,
   'sessoes_revogadas_em',NULL,'senha_alterada_em',NULL);
BEGIN
 -- Read immediately after auth.users; count is checked before any scenario changes.
 SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO actual
 FROM public.profiles p WHERE p.id='ac000000-0000-4000-8000-000000000001';
 PERFORM pg_temp.assert_integration_auth_profile(actual,expected);
 RAISE NOTICE 'PASS fixture automatic Auth profile exactly one and canonical attributes';
 -- Negative controls use copies of the actual row, never mutate the real profile.
 -- The very same validator must reject drift in every critical attribute.
 FOR field IN SELECT jsonb_object_keys(expected) LOOP
   candidate := jsonb_set(actual,ARRAY['0',field],to_jsonb('UNEXPECTED'::text));
   rejected := false;
   BEGIN
     PERFORM pg_temp.assert_integration_auth_profile(candidate,expected);
   EXCEPTION WHEN check_violation THEN
     IF SQLERRM <> 'QA_AUTH_PROFILE_CANONICAL_DRIFT' THEN RAISE; END IF;
     rejected := true;
   END;
   IF NOT rejected THEN RAISE EXCEPTION 'FAIL fixture accepted drift: %',field; END IF;
 END LOOP;
 FOREACH candidate IN ARRAY ARRAY['[]'::jsonb,actual || actual] LOOP
   rejected := false;
   BEGIN
     PERFORM pg_temp.assert_integration_auth_profile(candidate,expected);
   EXCEPTION WHEN check_violation THEN
     IF SQLERRM <> 'QA_AUTH_PROFILE_CARDINALITY' THEN RAISE; END IF;
     rejected := true;
   END;
   IF NOT rejected THEN RAISE EXCEPTION 'FAIL fixture accepted invalid profile count'; END IF;
 END LOOP;
 RAISE NOTICE 'PASS fixture negative controls reject critical drift and missing/duplicate profiles';
END;
$fixture$;
INSERT INTO public.usuario_papeis(usuario_id,papel,ativo,origem)
 VALUES ('ac000000-0000-4000-8000-000000000001','super_admin',true,'administracao');
INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj)
 VALUES ('ac000000-0000-4000-8000-000000000011','QA LOCAL A','98000000000168','QA','98000000000168','QA','98000000000168'),
 ('ac000000-0000-4000-8000-000000000012','QA LOCAL B','98000000000249','QA','98000000000249','QA','98000000000249');
SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
 f uuid := 'ac000000-0000-4000-8000-000000000011';
 g uuid := 'ac000000-0000-4000-8000-000000000012';
 d jsonb; next_d jsonb; state jsonb; i uuid; c uuid; n uuid; scenario text; before_count integer;
BEGIN
 d := public.admin_salvar_integracao_com_credencial(f,NULL,NULL,'SINQIA','Portal FIDC','sinqia_portal_fidc',
  ARRAY['ESTOQUE'],'homologacao','https://example.invalid','','{"relatorios_financeiros":{"cnpj_fundo":"98000000000168"}}',NULL,'QA inline',
  'v1:QA:QA:QA','v1:QA:QA:QA','qa','q*');
 i := (d->>'integracao_id')::uuid;
 state := public.admin_obter_configuracoes_tecnicas_fundo(f);
 SELECT (v->>'credencial_integracao_id')::uuid INTO c
 FROM jsonb_array_elements(state->'integracoes') integ,
 jsonb_array_elements(integ->'versoes') v WHERE v->>'id'=d->>'id';
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(state->'credenciais') x
  WHERE x->>'id'=c::text AND x->>'status'='rascunho' AND x->>'integracao_fundo_id'=i::text) THEN
  RAISE EXCEPTION 'FAIL initial draft and pending credential';
 END IF;
 IF state::text LIKE '%v1:QA%' OR state::text LIKE '%criptografad%' THEN RAISE EXCEPTION 'FAIL redaction'; END IF;
 PERFORM public.admin_publicar_integracao_versao(f,(d->>'id')::uuid);
 state := public.admin_obter_configuracoes_tecnicas_fundo(f);
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(state->'credenciais') x WHERE x->>'id'=c::text AND x->>'status'='ativa') THEN
  RAISE EXCEPTION 'FAIL first activation';
 END IF;
 -- Rotation prepared with an invalid endpoint: it must not affect the current version.
 next_d := public.admin_salvar_integracao_com_credencial(f,i,NULL,'SINQIA','Portal FIDC','sinqia_portal_fidc',
  ARRAY['ESTOQUE'],'homologacao','','','{"relatorios_financeiros":{"cnpj_fundo":"98000000000168"}}',NULL,'QA rotation',
  'v1:QB:QB:QB','v1:QB:QB:QB','qa','q*');
 state := public.admin_obter_configuracoes_tecnicas_fundo(f);
 SELECT (v->>'credencial_integracao_id')::uuid INTO n
 FROM jsonb_array_elements(state->'integracoes') integ,
 jsonb_array_elements(integ->'versoes') v WHERE v->>'id'=next_d->>'id';
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(state->'credenciais') x WHERE x->>'id'=c::text AND x->>'status'='ativa') THEN
  RAISE EXCEPTION 'FAIL preparation interrupted active credential';
 END IF;
 BEGIN
  PERFORM public.admin_ativar_credencial_integracao(f,n);
  RAISE EXCEPTION 'FAIL isolated activation interrupted published version';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.admin_publicar_integracao_versao(f,(next_d->>'id')::uuid);
  RAISE EXCEPTION 'FAIL invalid endpoint published';
 EXCEPTION WHEN check_violation THEN NULL; END;
 state := public.admin_obter_configuracoes_tecnicas_fundo(f);
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(state->'credenciais') x WHERE x->>'id'=c::text AND x->>'status'='ativa') THEN
  RAISE EXCEPTION 'FAIL failed publish changed previous credential';
 END IF;
 before_count := jsonb_array_length(state->'credenciais');
 BEGIN
  PERFORM public.admin_salvar_integracao_com_credencial(f,i,(next_d->>'id')::uuid,'SINQIA','Portal FIDC','sinqia_portal_fidc',
   ARRAY['ESTOQUE'],'homologacao','','','{"relatorios_financeiros":{"cnpj_fundo":"98000000000168"}}','2000-01-01','QA stale',
   'v1:QC:QC:QC','v1:QC:QC:QC','qa','q*');
  RAISE EXCEPTION 'FAIL stale draft accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 state := public.admin_obter_configuracoes_tecnicas_fundo(f);
 IF jsonb_array_length(state->'credenciais')<>before_count THEN RAISE EXCEPTION 'FAIL partial credential persisted'; END IF;
 -- The pending credential cannot be claimed across fund or environment.
 FOREACH scenario IN ARRAY ARRAY['fund','environment','provider','capability'] LOOP
  BEGIN
   PERFORM public.admin_salvar_integracao_rascunho(
    CASE WHEN scenario='fund' THEN g ELSE f END,NULL,NULL,
    CASE WHEN scenario='provider' THEN 'OUTRO' ELSE 'SINQIA' END,'QA','sinqia_portal_fidc',
    CASE WHEN scenario='capability' THEN ARRAY['CARTEIRA'] ELSE ARRAY['ESTOQUE'] END,
    CASE WHEN scenario='environment' THEN 'producao' ELSE 'homologacao' END,'','',n);
   RAISE EXCEPTION 'FAIL scope mismatch %',scenario;
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 -- Fail after credential activation, in the publication trigger, to exercise full rollback.
 next_d := public.admin_salvar_integracao_rascunho(f,i,(next_d->>'id')::uuid,'SINQIA','Portal FIDC',
  'sinqia_portal_fidc',ARRAY['ESTOQUE'],'homologacao','https://example.invalid','',n,'{}',(next_d->>'updated_at')::timestamptz);
 BEGIN
  PERFORM public.admin_publicar_integracao_versao(f,(next_d->>'id')::uuid);
  RAISE EXCEPTION 'FAIL invalid financial config published';
 EXCEPTION WHEN check_violation THEN NULL; END;
 state := public.admin_obter_configuracoes_tecnicas_fundo(f);
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(state->'credenciais') x WHERE x->>'id'=c::text AND x->>'status'='ativa')
  OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(state->'credenciais') x WHERE x->>'id'=n::text AND x->>'status'='rascunho') THEN
  RAISE EXCEPTION 'FAIL late publication rollback';
 END IF;
 next_d := public.admin_salvar_integracao_rascunho(f,i,(next_d->>'id')::uuid,'SINQIA','Portal FIDC',
  'sinqia_portal_fidc',ARRAY['ESTOQUE'],'homologacao','https://example.invalid','',n,'{"relatorios_financeiros":{"cnpj_fundo":"98000000000168"}}',(next_d->>'updated_at')::timestamptz);
 PERFORM public.admin_publicar_integracao_versao(f,(next_d->>'id')::uuid);
 state := public.admin_obter_configuracoes_tecnicas_fundo(f);
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(state->'credenciais') x WHERE x->>'id'=c::text AND x->>'status'='substituida')
  OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(state->'credenciais') x WHERE x->>'id'=n::text AND x->>'status'='ativa') THEN
  RAISE EXCEPTION 'FAIL rotation activation';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(state->'integracoes') integ, jsonb_array_elements(integ->'versoes') v
  WHERE v->>'id'=d->>'id' AND v->>'credencial_integracao_id'=c::text AND v->>'status'='substituida'
 ) THEN RAISE EXCEPTION 'FAIL historical snapshot'; END IF;
 PERFORM public.admin_publicar_integracao_versao(f,(next_d->>'id')::uuid);
 PERFORM public.admin_preparar_teste_integracao(f,(next_d->>'id')::uuid);
 BEGIN
  PERFORM 1 FROM public.credenciais_integracao;
  RAISE EXCEPTION 'FAIL direct secret read';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
 BEGIN
  PERFORM public.admin_salvar_integracao_com_credencial(f,NULL,NULL,'SINQIA','Portal FIDC','sinqia_portal_fidc',
   ARRAY['ESTOQUE'],'homologacao','','','{"relatorios_financeiros":{"cnpj_fundo":"98000000000168"}}',NULL,'QA denied','v1:QA:QA:QA','v1:QA:QA:QA','qa','q*');
  RAISE EXCEPTION 'FAIL missing MFA';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS inline create, staged rotation, atomic publish, rollback, snapshot, scope isolation, MFA, redaction, ACL';
END $$;
RESET ROLE;
UPDATE public.usuario_papeis SET ativo=false,revogado_em=now() WHERE usuario_id='ac000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.admin_salvar_integracao_com_credencial('ac000000-0000-4000-8000-000000000011',NULL,NULL,'SINQIA','Portal FIDC','sinqia_portal_fidc',
   ARRAY['ESTOQUE'],'homologacao','','','{"relatorios_financeiros":{"cnpj_fundo":"98000000000168"}}',NULL,'QA denied','v1:QA:QA:QA','v1:QA:QA:QA','qa','q*');
  RAISE EXCEPTION 'FAIL non super-admin';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS non super-admin denied';
END $$;
ROLLBACK;
