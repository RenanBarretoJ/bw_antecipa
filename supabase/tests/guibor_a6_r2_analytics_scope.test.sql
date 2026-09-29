\set ON_ERROR_STOP on
BEGIN;
SELECT no_plan();
\ir fixtures/guibor_a5_a6.sql
UPDATE public.consultor_cedentes SET comissao_percentual=10 WHERE consultor_id='29000000-0000-4000-8000-000000000001';
INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
VALUES('22000000-0000-4000-8000-000000000002','Fundo QA OFF','98200020000119','ADM QA','98000000000277','Gestora QA','98000000000358',true);
INSERT INTO public.cedentes(id,cnpj,razao_social,status,fundo_id)
VALUES('23000000-0000-4000-8000-000000000002','98100000000249','Cedente QA OFF','ativo','22000000-0000-4000-8000-000000000002');
INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id,status)
VALUES('24000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','ativo');
INSERT INTO public.consultor_fundos(consultor_id,fundo_id,status,concedido_por)
VALUES('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000002','ativo','21000000-0000-4000-8000-000000000004');
INSERT INTO public.consultor_cedentes(consultor_id,cedente_id,status,comissao_percentual,vinculado_por)
VALUES('29000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000002','ativo',50,'21000000-0000-4000-8000-000000000004');
INSERT INTO public.contas_escrow(id,cedente_id,identificador,status)
VALUES('25000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000002','ESCROW-QA-OFF','ativa');
-- Legacy-shaped synthetic portfolio: A6 must not alter its persisted financial fields.
INSERT INTO public.operacoes(id,cedente_id,cedente_fundo_id,conta_escrow_id,valor_bruto_total,valor_liquido_desembolso,taxa_desconto,prazo_dias,data_vencimento,status)
VALUES
 ('2c000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001',10000,9000,2.5,30,current_date+30,'em_andamento'),
 ('2c000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000002','25000000-0000-4000-8000-000000000002',40000,35000,2.5,30,current_date+30,'em_andamento');

SELECT ok(NOT has_function_privilege('authenticated','private.consultor_escopo_analitico()','EXECUTE'),'raw analytics scope is internal only');
SELECT ok(NOT has_function_privilege('anon','public.dashboard_consultor_resumo()','EXECUTE'),'anonymous dashboard denied');
SELECT ok(NOT has_function_privilege('service_role','public.dashboard_consultor_resumo()','EXECUTE'),'service without human identity is not analytics reader');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.dashboard_consultor_resumo()'::regprocedure),'public wrapper remains invoker');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"aal":"aal2","role":"authenticated"}',true);

UPDATE public.consultor_usuarios SET papel='OWNER' WHERE user_id='21000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((public.dashboard_consultor_resumo()->>'cedentesTotal')::int,2,'OWNER reads organizational portfolio');
SELECT is((public.dashboard_consultor_resumo()->>'volumeAtivo')::numeric,50000::numeric,'OWNER sees both scoped funds');
SELECT is((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))->>'total')::int,2,'OWNER reads report');
SELECT throws_ok($$SELECT private.consultor_escopo_analitico()$$,'42501',NULL,'OWNER cannot call raw scope');
SELECT throws_ok($$SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',true)$$,'42501',NULL,'OWNER cannot self-enable');
RESET ROLE;

UPDATE public.consultor_usuarios SET papel='ADMIN' WHERE user_id='21000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((public.dashboard_consultor_resumo()->>'cedentesTotal')::int,2,'ADMIN reads organizational portfolio');
SELECT is((public.dashboard_consultor_resumo()->>'volumeAtivo')::numeric,50000::numeric,'ADMIN sees both scoped funds');
SELECT is((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))->>'total')::int,2,'ADMIN reads report');
SELECT throws_ok($$SELECT private.consultor_escopo_analitico()$$,'42501',NULL,'ADMIN cannot call raw scope');
SELECT throws_ok($$SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',true)$$,'42501',NULL,'ADMIN cannot self-enable');
RESET ROLE;

UPDATE public.consultor_usuarios SET papel='OPERADOR' WHERE user_id='21000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((public.dashboard_consultor_resumo()->>'cedentesTotal')::int,2,'OPERADOR reads organizational portfolio');
SELECT is((public.dashboard_consultor_resumo()->>'volumeAtivo')::numeric,50000::numeric,'OPERADOR sees both scoped funds');
SELECT is((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))->>'total')::int,2,'OPERADOR reads report');
SELECT throws_ok($$SELECT private.consultor_escopo_analitico()$$,'42501',NULL,'OPERADOR cannot call raw scope');
SELECT throws_ok($$SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',true)$$,'42501',NULL,'OPERADOR cannot self-enable');
RESET ROLE;

UPDATE public.consultor_usuarios SET papel='LEITOR' WHERE user_id='21000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((public.dashboard_consultor_resumo()->>'cedentesTotal')::int,2,'LEITOR reads organizational portfolio');
SELECT is((public.dashboard_consultor_resumo()->>'volumeAtivo')::numeric,50000::numeric,'LEITOR sees both scoped funds');
SELECT is((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))->>'total')::int,2,'LEITOR reads report');
SELECT throws_ok($$SELECT private.consultor_escopo_analitico()$$,'42501',NULL,'LEITOR cannot call raw scope');
SELECT throws_ok($$SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',true)$$,'42501',NULL,'LEITOR cannot self-enable');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT ok(NOT private.consultor_usuario_pode_operar_cedente(auth.uid(),'23000000-0000-4000-8000-000000000001'),'LEITOR remains non-operator');
WITH changed AS (UPDATE public.notas_fiscais SET data_vencimento=current_date+90 WHERE id='2a000000-0000-4000-8000-000000000001' RETURNING id)
SELECT is((SELECT count(*)::int FROM changed),0,'LEITOR cannot write NF');
SELECT throws_ok($$SELECT public.relatorio_consultor_analitico(NULL)$$,'22023',NULL,'null month rejected');
SELECT throws_ok($$SELECT public.relatorio_consultor_analitico('2026-13')$$,'22023',NULL,'invalid month rejected');
RESET ROLE;
-- Same cedente, second fund: a portfolio match must never authorize every fund.
INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id,status)
VALUES('24000000-0000-4000-8000-000000000003','23000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000002','ativo');
INSERT INTO public.operacoes(id,cedente_id,cedente_fundo_id,conta_escrow_id,valor_bruto_total,valor_liquido_desembolso,taxa_desconto,prazo_dias,data_vencimento,status)
VALUES('2c000000-0000-4000-8000-000000000003','23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000003','25000000-0000-4000-8000-000000000001',70000,65000,2.5,30,current_date+30,'em_andamento');
UPDATE public.consultor_fundos SET status='inativo' WHERE fundo_id='22000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT is((public.dashboard_consultor_resumo()->>'volumeAtivo')::numeric,10000::numeric,'same cedente in revoked fund is excluded');
SELECT is((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))#>>'{resumo,volumeAcumulado}')::numeric,10000::numeric,'report excludes revoked fund');
SELECT is(jsonb_array_length(public.dashboard_consultor_resumo()->'operacoesRecentes'),1,'recent rows exclude revoked fund');
RESET ROLE;

UPDATE public.fundos SET ativo=false WHERE id='22000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((public.dashboard_consultor_resumo()->>'cedentesTotal')::int,0,'inactive fundos excludes portfolio');
SELECT is((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))->>'total')::int,0,'inactive fundos excludes report');
RESET ROLE;
UPDATE public.fundos SET ativo=true WHERE id='22000000-0000-4000-8000-000000000001';

UPDATE public.cedente_fundos SET status='suspenso' WHERE id='24000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((public.dashboard_consultor_resumo()->>'cedentesTotal')::int,0,'inactive cedente_fundos excludes portfolio');
SELECT is((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))->>'total')::int,0,'inactive cedente_fundos excludes report');
RESET ROLE;
UPDATE public.cedente_fundos SET status='ativo' WHERE id='24000000-0000-4000-8000-000000000001';

UPDATE public.consultor_cedentes SET status='inativo' WHERE cedente_id='23000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((public.dashboard_consultor_resumo()->>'cedentesTotal')::int,0,'inactive consultor_cedentes excludes portfolio');
SELECT is((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))->>'total')::int,0,'inactive consultor_cedentes excludes report');
RESET ROLE;
UPDATE public.consultor_cedentes SET status='ativo' WHERE cedente_id='23000000-0000-4000-8000-000000000001';

UPDATE public.cedentes SET status='bloqueado' WHERE id='23000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((public.dashboard_consultor_resumo()->>'cedentesTotal')::int,0,'inactive cedentes excludes portfolio');
SELECT is((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))->>'total')::int,0,'inactive cedentes excludes report');
RESET ROLE;
UPDATE public.cedentes SET status='ativo' WHERE id='23000000-0000-4000-8000-000000000001';

UPDATE public.consultor_usuarios SET status='inativo',desativado_em=now() WHERE user_id='21000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.dashboard_consultor_resumo()$$,'42501',NULL,'inactive consultor_usuarios denies dashboard');
SELECT throws_ok($$SELECT public.relatorio_consultor_analitico('2026-09')$$,'42501',NULL,'inactive consultor_usuarios denies report');
RESET ROLE;
UPDATE public.consultor_usuarios SET status='ativo',desativado_em=NULL WHERE user_id='21000000-0000-4000-8000-000000000001';

UPDATE public.consultores SET status='inativo' WHERE id='29000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.dashboard_consultor_resumo()$$,'42501',NULL,'inactive consultores denies dashboard');
SELECT throws_ok($$SELECT public.relatorio_consultor_analitico('2026-09')$$,'42501',NULL,'inactive consultores denies report');
RESET ROLE;
UPDATE public.consultores SET status='ativo' WHERE id='29000000-0000-4000-8000-000000000001';

UPDATE public.profiles SET status='inativo' WHERE id='21000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.dashboard_consultor_resumo()$$,'42501',NULL,'inactive profiles denies dashboard');
SELECT throws_ok($$SELECT public.relatorio_consultor_analitico('2026-09')$$,'42501',NULL,'inactive profiles denies report');
RESET ROLE;
UPDATE public.profiles SET status='ativo' WHERE id='21000000-0000-4000-8000-000000000001';

INSERT INTO public.consultores(id,cnpj,razao_social,status,created_by)
VALUES('29000000-0000-4000-8000-000000000002','98200020000100','Other QA organization','ativo','21000000-0000-4000-8000-000000000004');
UPDATE public.consultor_usuarios SET consultor_id='29000000-0000-4000-8000-000000000002' WHERE user_id='21000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((public.dashboard_consultor_resumo()->>'cedentesTotal')::int,0,'other organization cannot see original portfolio');
SELECT is((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'),NULL,NULL,'23000000-0000-4000-8000-000000000001')->>'total')::int,0,'forged cedente filter cannot cross organization');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000003',true);
SELECT throws_ok($$SELECT public.dashboard_consultor_resumo()$$,'42501',NULL,'cedente cannot access consultant projection');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT throws_ok($$SELECT public.dashboard_consultor_resumo()$$,'42501',NULL,'missing identity denied');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
