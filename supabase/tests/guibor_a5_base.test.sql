\set ON_ERROR_STOP on
BEGIN;
SELECT no_plan();
\ir fixtures/guibor_a5_a6.sql

SELECT is((SELECT base_valor_antecipacao FROM public.cedente_fundos WHERE id='24000000-0000-4000-8000-000000000001'),'BRUTO','default por vinculo e BRUTO');
SELECT is(private.resolver_valor_base_antecipacao('BRUTO',100000,90000,'DOCUMENTO_EXPLICITO',false),100000::numeric,'BRUTO fiscal');
SELECT is(private.resolver_valor_base_antecipacao('LIQUIDO',100000,90000,'DOCUMENTO_EXPLICITO',false),90000::numeric,'LIQUIDO fiscal');
SELECT throws_ok($$SELECT private.resolver_valor_base_antecipacao('LIQUIDO',100000,90000,'LEGACY_BRUTO',false)$$,'P0001','Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas','provenance legada negada');
SELECT throws_ok($$SELECT private.resolver_valor_base_antecipacao('LIQUIDO',100000,NULL,NULL,false)$$,'P0001','Antecipacao pelo liquido exige valor fiscal explicito ou calculado com retencoes comprovadas','liquido ausente negado');
SELECT throws_ok($$SELECT private.resolver_valor_base_antecipacao('LIQUIDO',100000,90000,'DOCUMENTO_EXPLICITO',true)$$,'P0001','Antecipacao pelo valor liquido indisponivel para notas parceladas','LIQUIDO parcelado negado');

SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"aal":"aal2","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.configurar_base_antecipacao('24000000-0000-4000-8000-000000000001','LIQUIDO')$$,'42501','Acesso nao autorizado a configuracao do fundo','Consultor nao altera politica');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000002',true);
SELECT throws_ok($$SELECT public.configurar_base_antecipacao('24000000-0000-4000-8000-000000000001','LIQUIDO')$$,'42501','Acesso nao autorizado a configuracao do fundo','LEITOR nao altera politica');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000003',true);
SELECT throws_ok($$SELECT public.configurar_base_antecipacao('24000000-0000-4000-8000-000000000001','LIQUIDO')$$,'42501','Acesso nao autorizado a configuracao do fundo','Cedente nao altera politica');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',true);
SELECT lives_ok($$SELECT public.configurar_base_antecipacao('24000000-0000-4000-8000-000000000001','LIQUIDO')$$,'Gestor autorizado altera base');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.logs_auditoria WHERE tipo_evento='BASE_ANTECIPACAO_ALTERADA'),1::bigint,'alteracao auditada uma vez');

SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT set_config('qa.op',public.solicitar_operacao_antecipacao_consultor_atomica(
 '23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
 '26000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001',1,
 '{"calculo_financeiro":{"metodo":"TRINTA_360"}}',repeat('a',64),false,'dispensado',
 ARRAY['2a000000-0000-4000-8000-000000000001']::uuid[],2.4,'guibor-a5-net-001',NULL)->>'operacao_id',true);
RESET ROLE;
SELECT is((SELECT valor_bruto_total FROM public.operacoes WHERE id=current_setting('qa.op')::uuid),90000::numeric,'proposta livre usa base 90k');
SELECT is((SELECT base_antecipacao_snapshot->>'base' FROM public.operacoes WHERE id=current_setting('qa.op')::uuid),'LIQUIDO','politica congelada');
SELECT is((SELECT (base_antecipacao_snapshot#>>'{notas,0,valor_bruto_fiscal}')::numeric FROM public.operacoes WHERE id=current_setting('qa.op')::uuid),100000::numeric,'bruto fiscal preservado');
SELECT is((SELECT valor_bruto FROM public.notas_fiscais WHERE id='2a000000-0000-4000-8000-000000000001'),100000::numeric,'NF original nao repricificada');
SELECT throws_ok($$UPDATE public.operacoes SET base_antecipacao_snapshot=NULL WHERE id=current_setting('qa.op')::uuid$$,'P0001','Base de antecipacao da operacao e imutavel','snapshot imutavel inclusive para executor privilegiado');

SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.configurar_base_antecipacao('24000000-0000-4000-8000-000000000001','BRUTO')$$,'troca futura para BRUTO');
RESET ROLE;
-- Internal evaluator fixture; authenticated approval still uses the public risk-gated RPC.
INSERT INTO public.risco_execucoes(id,fundo_id,operacao_id,escopo,origem,politica_operacional_versao_id,
 data_operacional,overlay_as_of,operacao_updated_at_snapshot,taxa_desconto_snapshot,aplicavel,status_tecnico,decisao,assinatura_inputs,criado_por)
SELECT '2b000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',o.id,'OPERACAO','APROVACAO_OPERACAO',
 o.politica_operacional_versao_id,current_date,now(),o.updated_at,2.4,false,'NAO_APLICAVEL',NULL,repeat('1',64),'21000000-0000-4000-8000-000000000004'
FROM public.operacoes o WHERE id=current_setting('qa.op')::uuid;
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.aprovar_operacao_com_risco_atomica(current_setting('qa.op')::uuid,2.4,'2b000000-0000-4000-8000-000000000001',repeat('1',64))$$,'gestor mantem taxa livre com base congelada');
RESET ROLE;
SELECT is((SELECT valor_bruto_total FROM public.operacoes WHERE id=current_setting('qa.op')::uuid),90000::numeric,'aprovacao ignora politica viva BRUTO');
SELECT is((SELECT valor_nominal FROM public.operacao_calculo_nfs WHERE operacao_id=current_setting('qa.op')::uuid),90000::numeric,'memoria P17 usa base congelada');
SELECT is((SELECT valor_liquido_desembolso FROM public.operacoes WHERE id=current_setting('qa.op')::uuid),
 (private.calcular_memoria_financeira_nf('2a000000-0000-4000-8000-000000000001',90000,2.4,(timezone('America/Sao_Paulo',now()))::date,current_date+30,'TRINTA_360')->>'valor_presente')::numeric,'mesma engine P17');

SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT public.configurar_base_antecipacao('24000000-0000-4000-8000-000000000001','LIQUIDO');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000003',true);
SELECT set_config('qa.multi',public.solicitar_operacao_antecipacao_cedente_atomica(
 '23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
 '26000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001',1,
 '{"calculo_financeiro":{"metodo":"TRINTA_360"}}',repeat('a',64),false,'dispensado',
 ARRAY['2a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000003']::uuid[],
 1,2.5,1,1,current_date+30,'guibor-a5-multi-002',NULL)->>'operacao_id',true);
RESET ROLE;
SELECT is((SELECT valor_bruto_total FROM public.operacoes WHERE id=current_setting('qa.multi')::uuid),143008.80::numeric,'cedente direto recalcula no servidor, ignora totais forjados, soma liquidos A+B');
SELECT is((SELECT jsonb_array_length(base_antecipacao_snapshot->'notas') FROM public.operacoes WHERE id=current_setting('qa.multi')::uuid),2,'snapshot individual por NF');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.remover_nf_operacao_gestor_atomica(current_setting('qa.multi')::uuid,'2a000000-0000-4000-8000-000000000002')$$,'remocao atomica continua funcional');
RESET ROLE;
SELECT is((SELECT valor_bruto_total FROM public.operacoes WHERE id=current_setting('qa.multi')::uuid),105779.10::numeric,'remocao soma somente base congelada restante');
SELECT is((SELECT jsonb_array_length(base_antecipacao_snapshot->'notas') FROM public.operacoes WHERE id=current_setting('qa.multi')::uuid),2,'snapshot original preservado como historico');

-- A fresh BRUTO operation without a configured rate still captures fiscal inputs.
SET LOCAL ROLE authenticated;
SELECT public.configurar_base_antecipacao('24000000-0000-4000-8000-000000000001','BRUTO');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000003',true);
SELECT set_config('qa.gross',public.solicitar_operacao_antecipacao_cedente_atomica(
 '23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
 '26000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001',1,
 '{"calculo_financeiro":{"metodo":"TRINTA_360"}}',repeat('a',64),false,'dispensado',
 ARRAY['2a000000-0000-4000-8000-000000000002']::uuid[],1,NULL,1,NULL,current_date+30,'guibor-a5-gross-003',NULL)->>'operacao_id',true);
RESET ROLE;
SELECT is((SELECT valor_bruto_total FROM public.operacoes WHERE id=current_setting('qa.gross')::uuid),39521.98::numeric,'BRUTO usa bruto fiscal mesmo com taxa pendente');
SELECT ok((SELECT taxa_desconto IS NULL FROM public.operacoes WHERE id=current_setting('qa.gross')::uuid),'taxa pendente nao e fabricada');
SELECT set_config('qa.gross_snapshot',(SELECT base_antecipacao_snapshot::text FROM public.operacoes WHERE id=current_setting('qa.gross')::uuid),true);

-- Same state transitions as the existing cancel action; retain the historical link.
SET LOCAL ROLE authenticated;
UPDATE public.operacoes SET status='cancelada' WHERE id=current_setting('qa.gross')::uuid;
UPDATE public.notas_fiscais SET status='aprovada',aprovacao_sacado_em=NULL WHERE id='2a000000-0000-4000-8000-000000000002';
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',true);
SELECT public.configurar_base_antecipacao('24000000-0000-4000-8000-000000000001','LIQUIDO');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
SELECT set_config('qa.reused',public.solicitar_operacao_antecipacao_consultor_atomica(
 '23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
 '26000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001',1,
 '{"calculo_financeiro":{"metodo":"TRINTA_360"}}',repeat('a',64),false,'dispensado',
 ARRAY['2a000000-0000-4000-8000-000000000002']::uuid[],2.4,'guibor-a5-reused-004',NULL)->>'operacao_id',true);
RESET ROLE;
SELECT is((SELECT valor_bruto_total FROM public.operacoes WHERE id=current_setting('qa.reused')::uuid),37229.70::numeric,'P16 reutiliza NF cancelada com politica LIQUIDO atual');
SELECT is((SELECT base_antecipacao_snapshot::text FROM public.operacoes WHERE id=current_setting('qa.gross')::uuid),current_setting('qa.gross_snapshot'),'mudanca de politica e reutilizacao nao alteram snapshot BRUTO historico');
SELECT is((SELECT count(*) FROM public.operacoes_nfs WHERE nota_fiscal_id='2a000000-0000-4000-8000-000000000002'),2::bigint,'participacao cancelada preservada e novo vinculo criado');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',true);
UPDATE public.operacoes SET status='reprovada',motivo_reprovacao='QA A5 P14' WHERE id=current_setting('qa.reused')::uuid;
UPDATE public.notas_fiscais SET status='aprovada',aprovacao_sacado_em=NULL WHERE id='2a000000-0000-4000-8000-000000000002';
SELECT public.configurar_base_antecipacao('24000000-0000-4000-8000-000000000001','BRUTO');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
SELECT set_config('qa.rejected_reuse',public.solicitar_operacao_antecipacao_consultor_atomica(
 '23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
 '26000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001',1,
 '{"calculo_financeiro":{"metodo":"TRINTA_360"}}',repeat('a',64),false,'dispensado',
 ARRAY['2a000000-0000-4000-8000-000000000002']::uuid[],2.4,'guibor-a5-rejected-005',NULL)->>'operacao_id',true);
RESET ROLE;
SELECT is((SELECT valor_bruto_total FROM public.operacoes WHERE id=current_setting('qa.rejected_reuse')::uuid),39521.98::numeric,'P14 reutiliza NF reprovada com novo snapshot BRUTO');
SELECT is((SELECT base_antecipacao_snapshot->>'base' FROM public.operacoes WHERE id=current_setting('qa.reused')::uuid),'LIQUIDO','snapshot da operacao reprovada permanece LIQUIDO');
SELECT ok(NOT has_function_privilege('authenticated','private.capturar_base_antecipacao(uuid,uuid,uuid[],uuid[])','EXECUTE'),'cliente nao pode chamar captura privilegiada');
SELECT ok(NOT has_function_privilege('authenticated','public.aprovar_operacao_atomica_financeiro_v1(uuid,numeric)','EXECUTE'),'cliente nao pode contornar aprovacao publica com risco');

SELECT ok(NOT has_function_privilege('authenticated','public.solicitar_operacao_antecipacao_atomica(uuid,uuid,uuid,uuid,integer,jsonb,text,boolean,text,uuid[],numeric,numeric,integer,numeric,date,text)','EXECUTE'),'API obsoleta nao permite criar operacao sem snapshot');

SELECT * FROM finish();
ROLLBACK;
