-- Executar apenas numa copia LOCAL do schema ANTERIOR ao hotfix.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'integration_credential_%' THEN RAISE EXCEPTION 'Somente rehearsal local dedicado'; END IF;
END $$;
BEGIN;
INSERT INTO auth.users(id,email) VALUES ('ac100000-0000-4000-8000-000000000001','legacy-qa@example.invalid');
INSERT INTO public.profiles(id,nome_completo,email) VALUES ('ac100000-0000-4000-8000-000000000001','QA legado','legacy-qa@example.invalid');
INSERT INTO public.usuario_papeis(usuario_id,papel,origem) VALUES ('ac100000-0000-4000-8000-000000000001','super_admin','administracao');
INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj)
 VALUES ('ac100000-0000-4000-8000-000000000011','QA LOCAL UPGRADE','98000000000900','QA','98000000000900','QA','98000000000900');
SELECT set_config('request.jwt.claims','{"sub":"ac100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',false);
DO $$ DECLARE d jsonb; c uuid; f uuid := 'ac100000-0000-4000-8000-000000000011'; BEGIN
 d:= public.admin_salvar_integracao_rascunho(f,NULL,NULL,'SINQIA','QA legado','sinqia_portal_fidc',ARRAY['ESTOQUE'],'homologacao','https://example.invalid','',NULL);
 c:= (public.admin_cadastrar_credencial_integracao(f,(d->>'integracao_id')::uuid,'homologacao','QA legado','v1:QA:QA:QA','v1:QA:QA:QA','qa','q*')->>'id')::uuid;
 PERFORM public.admin_ativar_credencial_integracao(f,c);
 PERFORM public.admin_salvar_integracao_rascunho(f,(d->>'integracao_id')::uuid,(d->>'id')::uuid,'SINQIA','QA legado','sinqia_portal_fidc',ARRAY['ESTOQUE'],'homologacao','https://example.invalid','',c);
END $$;
CREATE TEMP TABLE credential_before AS SELECT id,md5(concat_ws('|',usuario_criptografado,senha_criptografada,chave_versao,fundo_id,integracao_fundo_id,ambiente,status)) AS fingerprint FROM public.credenciais_integracao;
CREATE TEMP TABLE version_before AS SELECT id,md5(to_jsonb(v)::text) AS fingerprint FROM public.integracao_fundo_versoes v;
COMMIT;
\i /tmp/integration_credential_first.sql
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM credential_before b FULL JOIN public.credenciais_integracao c USING(id)
 WHERE b.fingerprint IS DISTINCT FROM md5(concat_ws('|',c.usuario_criptografado,c.senha_criptografada,c.chave_versao,c.fundo_id,c.integracao_fundo_id,c.ambiente,c.status))) THEN RAISE EXCEPTION 'FAIL: credencial alterada'; END IF;
 IF EXISTS (SELECT 1 FROM version_before b FULL JOIN public.integracao_fundo_versoes v USING(id)
 WHERE b.fingerprint IS DISTINCT FROM md5(to_jsonb(v)::text)) THEN RAISE EXCEPTION 'FAIL: versao alterada'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.credenciais_integracao WHERE provider_key='SINQIA' AND status='ativa') THEN RAISE EXCEPTION 'FAIL: metadados legados'; END IF;
 RAISE NOTICE 'PASS upgrade preserva ciphertext, chave, fundo, FK, ambiente, status e versoes integrais';
END $$;
