-- Fixtures sinteticas, somente rehearsal LOCAL dedicado, sem trafego externo.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'integration_credential_%' THEN RAISE EXCEPTION 'Somente rehearsal local dedicado'; END IF;
END $$;
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('ad000000-0000-4000-8000-000000000001','cnab-gate@example.invalid','{"nome_completo":"QA"}');
INSERT INTO public.profiles(id,nome_completo,email) VALUES
 ('ad000000-0000-4000-8000-000000000001','QA','cnab-gate@example.invalid');
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
