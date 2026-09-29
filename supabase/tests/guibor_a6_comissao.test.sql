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
SELECT set_config('qa.financial_before',(SELECT md5(jsonb_agg(to_jsonb(o) ORDER BY id)::text) FROM public.operacoes o),true);
SELECT is((SELECT count(*) FROM public.consultor_fundos WHERE comissao_habilitada),0::bigint,'default OFF em todos os vinculos');

SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"aal":"aal2","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT (public.dashboard_consultor_resumo() ? 'comissaoEstimada'),'OFF nao projeta total de comissao');
SELECT ok(NOT (public.dashboard_consultor_resumo()->>'carteiraRecente' LIKE '%comissaoPercentual%'),'OFF nao projeta percentuais na carteira');
SELECT ok(NOT ((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))->'resumo') ? 'comissaoMes'),'OFF nao projeta comissao no resumo');
SELECT ok(NOT (public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))->>'items' LIKE '%comissaoMes%'),'OFF nao projeta comissao nas linhas');
SELECT throws_ok($$SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',true)$$,'42501','Acesso nao autorizado a configuracao do fundo','Consultor nao habilita sua comissao');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000002',true);
SELECT throws_ok($$SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',true)$$,'42501','Acesso nao autorizado a configuracao do fundo','LEITOR nao habilita comissao');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',true);
SELECT throws_ok($$SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000002',true)$$,'42501','Acesso nao autorizado a configuracao do fundo','Gestor nao altera outro fundo');
SELECT lives_ok($$SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',true)$$,'Gestor habilita seu fundo');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
SELECT is((public.dashboard_consultor_resumo()->>'comissaoEstimada')::numeric,900::numeric,'ON soma A e exclui B OFF (17500)');
SELECT is((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))#>>'{resumo,comissaoMes}')::numeric,900::numeric,'relatorio exclui B inclusive agregado');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))->'items') row
 WHERE row->>'cedenteId'='23000000-0000-4000-8000-000000000002' AND (row ? 'percentual' OR row ? 'comissaoMes')),'linha B OFF nao expoe campos de comissao');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000002',true);
SELECT is((public.dashboard_consultor_resumo()->>'comissaoEstimada')::numeric,900::numeric,'LEITOR preserva leitura C5 no fundo ON');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',true);
SELECT lives_ok($$SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',false)$$,'Gestor retorna OFF');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
SELECT ok(NOT (public.dashboard_consultor_resumo() ? 'comissaoEstimada'),'OFF novamente remove total');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.logs_auditoria WHERE tipo_evento='COMISSAO_CONSULTOR_FUNDO_ALTERADA'),2::bigint,'OFF ON OFF auditado');
SELECT is((SELECT md5(jsonb_agg(to_jsonb(o) ORDER BY id)::text) FROM public.operacoes o),current_setting('qa.financial_before'),'financeiro historico intocado');
SELECT * FROM finish();
ROLLBACK;
