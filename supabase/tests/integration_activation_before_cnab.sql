-- Fixtures sinteticas, somente rehearsal LOCAL dedicado, sem trafego externo.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'integration_credential_%' AND NOT (current_database() ~ '^r19_integrations_[0-9]+_[0-9a-f]{8}$' AND current_setting('application_name')='r19_local_sql') AND NOT (current_database()='postgres' AND current_setting('application_name') ~ '^r110_cnab_[0-9]{13}$') THEN RAISE EXCEPTION 'Somente rehearsal local dedicado'; END IF;
END $$;
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('ad000000-0000-4000-8000-000000000001','cnab-gate@example.invalid','{"nome_completo":"QA"}');
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
   'id','ad000000-0000-4000-8000-000000000001','email','cnab-gate@example.invalid',
   'nome_completo','QA','role','cedente','status','ativo','telefone',NULL,
   'mfa_obrigatorio_override',NULL,'mfa_ativado_em',NULL,
   'ultima_autenticacao_forte_em',NULL,'mfa_reset_em',NULL,
   'sessoes_revogadas_em',NULL,'senha_alterada_em',NULL);
BEGIN
 -- Read immediately after auth.users; count is checked before any scenario changes.
 SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO actual
 FROM public.profiles p WHERE p.id='ad000000-0000-4000-8000-000000000001';
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
 VALUES ('ad000000-0000-4000-8000-000000000001','super_admin',true,'administracao');
INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj)
 VALUES ('ad000000-0000-4000-8000-000000000011','QA CNAB A','98000000000168','QA','98000000000168','QA','98000000000168'),
 ('ad000000-0000-4000-8000-000000000012','QA CNAB B','98000000000249','QA','98000000000249','QA','98000000000249');
SELECT set_config('request.jwt.claims','{"sub":"ad000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
 f uuid := 'ad000000-0000-4000-8000-000000000011';
 g uuid := 'ad000000-0000-4000-8000-000000000012';
 d jsonb; cnab jsonb; state jsonb; v_id uuid; scenario integer;
BEGIN
 -- Sem integracao e com VRS CSV apenas: parametrizacao CNAB deve ser negada.
 FOR scenario IN 1..2 LOOP
  IF scenario=2 THEN
   PERFORM public.admin_salvar_integracao_rascunho(g,NULL,NULL,'VORTX','VRS','vortx_vrs',ARRAY['CESSAO_ENVIO'],'homologacao','','',NULL);
  END IF;
  BEGIN
   PERFORM public.admin_salvar_cnab_rascunho(g,NULL,NULL,'qa','QA',NULL,'cnab444','1','001','QA','0001','0002','','001','003','004','005','02','98000000000249','01','01','{}',repeat('a',64));
   RAISE EXCEPTION 'FAIL CNAB sem conector compativel';
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 d := public.admin_salvar_integracao_com_credencial(f,NULL,NULL,'SINQIA','Portal FIDC','sinqia_portal_fidc',
  ARRAY['CESSAO_ENVIO','ESTOQUE','AQUISICOES','LIQUIDACOES'],'homologacao','https://example.invalid','QA',
  '{"relatorios_financeiros":{"cnpj_fundo":"98000000000168"}}',NULL,'QA', 'v1:QA:QA:QA','v1:QA:QA:QA','qa','q*');
 v_id := (d->>'id')::uuid;
 PERFORM public.admin_publicar_integracao_versao(f,v_id);
 state := public.admin_obter_configuracoes_tecnicas_fundo(f);
 IF jsonb_array_length(state->'cnab') <> 0 THEN RAISE EXCEPTION 'FAIL CNAB criado implicitamente'; END IF;
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(state->'integracoes') i, jsonb_array_elements(i->'versoes') v
   WHERE v->>'id'=v_id::text AND v->>'status'='publicada' AND v->>'codigo_originador' IS NULL) THEN
   RAISE EXCEPTION 'FAIL ativacao antes do CNAB'; END IF;
 -- CNAB pode ser salvo/publicado apos ativacao sem republicar a integracao.
 cnab := public.admin_salvar_cnab_rascunho(f,NULL,NULL,'qa','QA',NULL,'cnab444','1','001','QA','0001','0002','','001','003','004','005','02','98000000000168','01','01','{}',repeat('a',64));
 PERFORM public.admin_publicar_cnab_versao(f,(cnab->>'id')::uuid);
 state := public.admin_obter_configuracoes_tecnicas_fundo(f);
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(state->'cnab') c, jsonb_array_elements(c->'versoes') v
   WHERE v->>'id'=cnab->>'id' AND v->>'status'='publicada') THEN RAISE EXCEPTION 'FAIL CNAB publicado'; END IF;
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(state->'integracoes') i, jsonb_array_elements(i->'versoes') v
   WHERE v->>'id'=v_id::text AND v->>'codigo_originador' IS NULL) THEN RAISE EXCEPTION 'FAIL snapshot regravado'; END IF;
 BEGIN
  PERFORM public.admin_publicar_cnab_versao(g,(cnab->>'id')::uuid);
  RAISE EXCEPTION 'FAIL acesso cruzado ao CNAB';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 RAISE NOTICE 'PASS ativacao sem CNAB, financeiro preservado, CNAB posterior, CSV sem CNAB, isolamento e snapshot';
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (public.resolver_integracao_por_capability('ad000000-0000-4000-8000-000000000011','homologacao','ESTOQUE')->>'status') <> 'CONFIGURADA' THEN
  RAISE EXCEPTION 'FAIL financeiro bloqueado'; END IF;
END $$;
ROLLBACK;
