-- Somente banco LOCAL de rehearsal. Fixtures sinteticas e rollback integral.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'integration_credential_%' AND NOT (current_database() ~ '^r19_integrations_[0-9]+_[0-9a-f]{8}$' AND current_setting('application_name')='r19_local_sql') AND NOT (current_database()='postgres' AND current_setting('application_name') ~ '^r110_cred_[0-9]{13}$') THEN RAISE EXCEPTION 'Somente rehearsal local dedicado'; END IF;
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
 c uuid; other_c uuid; d jsonb; linked jsonb; state jsonb; scenario text; env text; provider text; fund uuid; caps text[];
BEGIN
 -- Credential first: nenhum integration_id artificial e nenhuma publicacao implicita.
 c := (public.admin_cadastrar_credencial_integracao(f,NULL,'homologacao','QA previa','v1:QA:QA:QA','v1:QA:QA:QA','qa','q*',NULL,NULL,'SINQIA',ARRAY['ESTOQUE'])->>'id')::uuid;
 PERFORM public.admin_ativar_credencial_integracao(f,c);
 FOREACH scenario IN ARRAY ARRAY['fund','provider','environment','capability'] LOOP
   fund := CASE WHEN scenario='fund' THEN g ELSE f END;
   provider := CASE WHEN scenario='provider' THEN 'OUTRO' ELSE 'SINQIA' END;
   env := CASE WHEN scenario='environment' THEN 'producao' ELSE 'homologacao' END;
   caps := CASE WHEN scenario='capability' THEN ARRAY['CARTEIRA'] ELSE ARRAY['ESTOQUE'] END;
   BEGIN
     PERFORM public.admin_salvar_integracao_rascunho(fund,NULL,NULL,provider,'QA',NULL,caps,env,'','',c);
     RAISE EXCEPTION 'FAIL: % deveria ser negado',scenario;
   EXCEPTION WHEN check_violation THEN NULL;
   END;
 END LOOP;
 d := public.admin_salvar_integracao_rascunho(f,NULL,NULL,'SINQIA','QA', 'sinqia_portal_fidc',ARRAY['ESTOQUE'],'homologacao','https://example.invalid','',c);
 state := public.admin_obter_configuracoes_tecnicas_fundo(f);
 IF state->'credenciais'->0->>'integracao_fundo_id' IS DISTINCT FROM d->>'integracao_id' THEN RAISE EXCEPTION 'FAIL: primeiro vinculo'; END IF;
 IF state::text LIKE '%criptografad%' OR state::text LIKE '%v1:QA%' THEN RAISE EXCEPTION 'FAIL: redaction'; END IF;
 BEGIN
   PERFORM public.admin_salvar_integracao_rascunho(f,NULL,NULL,'SINQIA','QA outra',NULL,ARRAY['ESTOQUE'],'homologacao','','',c);
   RAISE EXCEPTION 'FAIL: reuso entre integracoes';
 EXCEPTION WHEN check_violation THEN NULL; END;
 RAISE NOTICE 'PASS credential-first, fund/provider/environment/capability isolation, exclusivity, redaction';

 -- Integration first e ausencia de credencial: rascunho permitido, teste/publicacao negados.
 d := public.admin_salvar_integracao_rascunho(f,NULL,NULL,'SINQIA','QA legado','sinqia_portal_fidc',ARRAY['ESTOQUE'],'homologacao','https://example.invalid','',NULL);
 BEGIN
   PERFORM public.admin_publicar_integracao_versao(f,(d->>'id')::uuid);
   RAISE EXCEPTION 'FAIL: publicou sem credencial';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   PERFORM public.admin_preparar_teste_integracao(f,(d->>'id')::uuid);
   RAISE EXCEPTION 'FAIL: testou sem credencial';
 EXCEPTION WHEN check_violation THEN NULL; END;
 other_c := (public.admin_cadastrar_credencial_integracao(f,(d->>'integracao_id')::uuid,'homologacao','QA legado','v1:QA:QA:QA','v1:QA:QA:QA','qa','q*')->>'id')::uuid;
 -- Inline credentials now support a pending reference in drafts only.
 d := public.admin_salvar_integracao_rascunho(f,(d->>'integracao_id')::uuid,(d->>'id')::uuid,'SINQIA','QA legado','sinqia_portal_fidc',ARRAY['ESTOQUE'],'homologacao','https://example.invalid','',other_c);
 PERFORM public.admin_ativar_credencial_integracao(f,other_c);
 linked := public.admin_salvar_integracao_rascunho(f,(d->>'integracao_id')::uuid,(d->>'id')::uuid,'SINQIA','QA legado','sinqia_portal_fidc',ARRAY['ESTOQUE'],'homologacao','https://example.invalid','',other_c,'{}',(d->>'updated_at')::timestamptz);
 BEGIN
   PERFORM public.admin_salvar_integracao_rascunho(f,(d->>'integracao_id')::uuid,(d->>'id')::uuid,'SINQIA','QA legado','sinqia_portal_fidc',ARRAY['ESTOQUE'],'homologacao','https://example.invalid','',other_c,'{}','2000-01-01'::timestamptz);
   RAISE EXCEPTION 'FAIL: perdeu controle de concorrencia';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 PERFORM public.admin_revogar_credencial_integracao(f,other_c,'QA revogacao local');
 BEGIN
   PERFORM public.admin_salvar_integracao_rascunho(f,(d->>'integracao_id')::uuid,(d->>'id')::uuid,'SINQIA','QA legado','sinqia_portal_fidc',ARRAY['ESTOQUE'],'homologacao','https://example.invalid','',other_c);
   RAISE EXCEPTION 'FAIL: vinculou revogada';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   PERFORM public.admin_ativar_credencial_integracao(f,other_c);
   RAISE EXCEPTION 'FAIL: reativou revogada';
 EXCEPTION WHEN check_violation THEN NULL; END;
 RAISE NOTICE 'PASS integration-first, draft without credential, publish/test gates, inactive/revoked denied, concurrency';
 BEGIN
   PERFORM 1 FROM public.credenciais_integracao;
   RAISE EXCEPTION 'FAIL: leitura direta de segredos';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS ciphertext direct read denied';
END $$;
RESET ROLE;
UPDATE public.usuario_papeis SET ativo=false, revogado_em=now() WHERE usuario_id='ac000000-0000-4000-8000-000000000001' AND papel='super_admin';
SET LOCAL ROLE authenticated;
DO $$ DECLARE actor text; BEGIN
 FOREACH actor IN ARRAY ARRAY['gestor','cedente','consultor','LEITOR'] LOOP
  -- Claims adulterados nao substituem usuario_papeis verificado no banco.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub','ac000000-0000-4000-8000-000000000001','role','authenticated','aal','aal2','user_metadata',jsonb_build_object('role',actor))::text,true);
  BEGIN
    PERFORM public.admin_cadastrar_credencial_integracao('ac000000-0000-4000-8000-000000000011',NULL,'homologacao','QA negado','v1:QA:QA:QA','v1:QA:QA:QA','qa','q*',NULL,NULL,'SINQIA');
    RAISE EXCEPTION 'FAIL: nao-admin criou credencial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 RAISE NOTICE 'PASS non-super-admin and spoofed role claims denied';
END $$;
ROLLBACK;
