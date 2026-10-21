\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'signed_contract_test' THEN RAISE EXCEPTION 'Somente banco descartavel dedicado'; END IF; END $$;
BEGIN;

CREATE FUNCTION pg_temp.check_test(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION pg_temp.expect_error(command text, expected text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got = RETURNED_SQLSTATE; END;
  IF got IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FAIL: % expected %, got %', label, expected, got; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;
CREATE FUNCTION pg_temp.path_for(version integer) RETURNS text LANGUAGE sql AS $$
 SELECT 'cedentes/ab100000-0000-4000-8000-000000000001/assinados/contrato-cessao/ab300000-0000-4000-8000-' || lpad(version::text,12,'0') || '.pdf';
$$;
CREATE FUNCTION pg_temp.register_version(version integer, previous text DEFAULT NULL,
 fund uuid DEFAULT 'ab200000-0000-4000-8000-000000000001',
 cedente uuid DEFAULT 'ab100000-0000-4000-8000-000000000001') RETURNS text LANGUAGE sql AS $$
 SELECT public.registrar_contrato_assinado_cedente(cedente,fund,previous,pg_temp.path_for(version),repeat('a',64),8,'contrato.pdf');
$$;

INSERT INTO auth.users(id,email,raw_user_meta_data)
SELECT ('ab000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'contrato-qa-'||n||'@example.invalid',
 jsonb_build_object('nome_completo','QA Contrato '||n,'role',CASE WHEN n=3 THEN 'cedente' ELSE 'gestor' END)
FROM generate_series(1,4) n;
-- Reutiliza o profile do trigger canonico, sem INSERT/DELETE/UPSERT de profile.
SELECT pg_temp.check_test(count(*)=4 AND bool_and(status::text='ativo') AND
 bool_and(role::text=CASE WHEN id='ab000000-0000-4000-8000-000000000003' THEN 'cedente' ELSE 'gestor' END),
 'profiles canonicos: unicidade, role e estado inicial') FROM public.profiles WHERE email LIKE 'contrato-qa-%@example.invalid';
INSERT INTO auth.sessions(id,user_id,aal,not_after)
 SELECT id,id,'aal2',now()+interval '1 day' FROM auth.users WHERE email LIKE 'contrato-qa-%@example.invalid';
INSERT INTO auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at,secret)
 SELECT id,id,'totp','verified',now(),now(),'JBSWY3DPEHPK3PXP' FROM auth.users WHERE email LIKE 'contrato-qa-%@example.invalid';
INSERT INTO public.sessoes_elevadas(user_id,session_id,metodo,factor_id,expira_em)
 SELECT id,id,'totp',id::text,now()+interval '1 day' FROM auth.users WHERE email LIKE 'contrato-qa-%@example.invalid';

INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo) VALUES
 ('ab200000-0000-4000-8000-000000000001','QA CONTRATO A','98992300000107','QA','98992300000107','QA','98992300000107',true),
 ('ab200000-0000-4000-8000-000000000002','QA CONTRATO B','98992300000280','QA','98992300000280','QA','98992300000280',true);
INSERT INTO public.cedentes(id,user_id,cnpj,razao_social) VALUES
 ('ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000003','98992300000360','QA CONTRATO A'),
 ('ab100000-0000-4000-8000-000000000002',NULL,'98992300000441','QA CONTRATO B');
INSERT INTO public.cedente_fundos(cedente_id,fundo_id) VALUES
 ('ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001'),
 ('ab100000-0000-4000-8000-000000000002','ab200000-0000-4000-8000-000000000002');
INSERT INTO public.usuario_fundos(usuario_id,fundo_id,perfil_no_fundo) VALUES
 ('ab000000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','gestor'),
 ('ab000000-0000-4000-8000-000000000002','ab200000-0000-4000-8000-000000000002','gestor'),
 ('ab000000-0000-4000-8000-000000000004','ab200000-0000-4000-8000-000000000001','auditor');
INSERT INTO storage.buckets(id,name,public) VALUES ('contratos','contratos',false);
INSERT INTO storage.objects(bucket_id,name,metadata,user_metadata)
 SELECT 'contratos',pg_temp.path_for(n),'{"size":8,"mimetype":"application/pdf"}',
 jsonb_build_object('sha256',repeat('a',64),'usuario_id','ab000000-0000-4000-8000-000000000001',
   'fundo_id','ab200000-0000-4000-8000-000000000001') FROM generate_series(1,4) n;

SELECT pg_temp.check_test(NOT has_function_privilege('anon','public.registrar_contrato_assinado_cedente(uuid,uuid,text,text,text,bigint,text)','EXECUTE'), 'anon sem execute');
SELECT pg_temp.check_test(NOT has_function_privilege('service_role','public.registrar_contrato_assinado_cedente(uuid,uuid,text,text,text,bigint,text)','EXECUTE'), 'service role sem execute');
SELECT pg_temp.check_test(has_function_privilege('authenticated','public.registrar_contrato_assinado_cedente(uuid,uuid,text,text,text,bigint,text)','EXECUTE'), 'authenticated com RPC restrita');

SELECT set_config('request.jwt.claims','{"sub":"ab000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"ab000000-0000-4000-8000-000000000001"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_test(current_user='authenticated' AND NOT (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname=current_user),'ator nao e owner/superuser/bypassrls');
SELECT pg_temp.check_test((SELECT status='valid' FROM public.obter_sessao_mfa_atual()),'sessao AAL2 TOTP canonica real');
SELECT pg_temp.check_test(pg_temp.register_version(1)=pg_temp.path_for(1),'Gestor legitimo registra contrato');
SELECT pg_temp.check_test(pg_temp.register_version(1)=pg_temp.path_for(1),'retry idempotente');
SELECT pg_temp.expect_error('SELECT pg_temp.register_version(2)','40001','CAS nega versao desatualizada');
SELECT pg_temp.expect_error($q$SELECT pg_temp.register_version(2,NULL,'ab200000-0000-4000-8000-000000000002')$q$,'42501','outro Fundo negado');
SELECT pg_temp.expect_error($q$SELECT pg_temp.register_version(2,NULL,'ab200000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000002')$q$,'42501','outro Cedente negado');
SELECT pg_temp.expect_error($q$SELECT public.registrar_contrato_assinado_cedente('ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',NULL,'../outro.pdf',repeat('a',64),8,'contrato.pdf')$q$,'22023','path adulterado negado');
SELECT pg_temp.expect_error($q$SELECT public.registrar_contrato_assinado_cedente('ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',NULL,pg_temp.path_for(2),repeat('a',64),4194305,'contrato.pdf')$q$,'22023','limite de payload validado no banco');
SELECT pg_temp.expect_error($q$SELECT public.registrar_contrato_assinado_cedente('ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',pg_temp.path_for(1),pg_temp.path_for(2),repeat('b',64),8,'contrato.pdf')$q$,'22023','hash precisa corresponder ao objeto verificado');
SELECT pg_temp.expect_error('SELECT pg_temp.register_version(9,pg_temp.path_for(1))','22023','objeto inexistente negado');
RESET ROLE;
SELECT pg_temp.check_test((SELECT count(*)=1 FROM public.logs_auditoria WHERE origem='api_cedente_contrato_assinado'),'retry nao duplica auditoria');
ALTER TABLE public.logs_auditoria ADD CONSTRAINT qa_contract_audit_failure CHECK (origem<>'api_cedente_contrato_assinado') NOT VALID;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.register_version(2,pg_temp.path_for(1))$q$,'23514','falha na auditoria aborta transacao');
RESET ROLE;
SELECT pg_temp.check_test((SELECT contrato_assinado_url=pg_temp.path_for(1) FROM public.cedentes WHERE id='ab100000-0000-4000-8000-000000000001'),'falha na auditoria preserva referencia anterior');
ALTER TABLE public.logs_auditoria DROP CONSTRAINT qa_contract_audit_failure;
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_test(pg_temp.register_version(2,pg_temp.path_for(1))=pg_temp.path_for(2),'substituicao com CAS');
SELECT pg_temp.expect_error('SELECT pg_temp.register_version(3,pg_temp.path_for(1))','40001','segunda solicitacao obsoleta negada');
SELECT set_config('request.jwt.claims','{"sub":"ab000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"ab000000-0000-4000-8000-000000000003"}',true);
SELECT pg_temp.expect_error('SELECT pg_temp.register_version(3)','42501','Cedente nao pode usar RPC de Gestor');
SELECT set_config('request.jwt.claims','{"sub":"ab000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"ab000000-0000-4000-8000-000000000004"}',true);
SELECT pg_temp.expect_error('SELECT pg_temp.register_version(3)','42501','perfil auditor negado');
SELECT set_config('request.jwt.claims','{"sub":"ab000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"ab000000-0000-4000-8000-000000000002"}',true);
SELECT pg_temp.expect_error('SELECT pg_temp.register_version(3)','42501','Gestor de outro Fundo negado');
SELECT set_config('request.jwt.claims','{"sub":"ab000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
SELECT pg_temp.expect_error('SELECT pg_temp.register_version(3)','42501','MFA sem sessao AAL2 negado');
RESET ROLE;
UPDATE public.sessoes_elevadas SET revogada_em=now() WHERE user_id='ab000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claims','{"sub":"ab000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"ab000000-0000-4000-8000-000000000001"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.register_version(3)','42501','MFA revogado negado');
RESET ROLE;
UPDATE public.sessoes_elevadas SET revogada_em=NULL WHERE user_id='ab000000-0000-4000-8000-000000000001';
UPDATE public.usuario_fundos SET status='revogado' WHERE usuario_id='ab000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.register_version(3)','42501','vinculo do Gestor revogado negado');
RESET ROLE;
UPDATE public.usuario_fundos SET status='ativo' WHERE usuario_id='ab000000-0000-4000-8000-000000000001';
UPDATE public.cedente_fundos SET status='suspenso' WHERE cedente_id='ab100000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.register_version(3)','42501','vinculo operacional suspenso negado');
RESET ROLE;
SELECT pg_temp.check_test((SELECT count(*)=2 FROM public.logs_auditoria WHERE origem='api_cedente_contrato_assinado'),'somente envios concluidos tem auditoria');
SELECT pg_temp.check_test((SELECT count(*)=4 FROM storage.objects WHERE bucket_id='contratos'),'arquivos anteriores e tentativas preservados pelo SQL');
SELECT pg_temp.check_test((SELECT contrato_assinado_url IS NULL FROM public.cedentes WHERE id='ab100000-0000-4000-8000-000000000002'),'outro Cedente intocado');
ROLLBACK;
