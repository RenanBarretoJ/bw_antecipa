-- Somente banco LOCAL de rehearsal. Fixtures sinteticas e rollback integral.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'integration_credential_%' THEN RAISE EXCEPTION 'Somente rehearsal local dedicado'; END IF;
END $$;
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('ac000000-0000-4000-8000-000000000001','credential-qa@example.invalid','{"nome_completo":"QA"}');
INSERT INTO public.profiles(id,nome_completo,email) VALUES
 ('ac000000-0000-4000-8000-000000000001','QA','credential-qa@example.invalid');
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
