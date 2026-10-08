\set ON_ERROR_STOP on
BEGIN;
SELECT no_plan();
\ir fixtures/guibor_a5_a6.sql
SELECT is(current_setting('session_replication_role'),'origin','real triggers stay enabled');
-- Official nf_danfe_pdf catalogue row is seeded by the runner. Add a synthetic
-- requirement to the synthetic policy and instantiate it through the real RPC.
-- Configure while DRAFT, then publish: never bypass the immutability trigger.
INSERT INTO public.politicas_operacionais(id,codigo,nome,status,created_by,fundo_id,padrao)
VALUES('26000000-0000-4000-8000-000000000002','QA_R13_DOCS','QA R13 documents','ativa',
 '21000000-0000-4000-8000-000000000004','22000000-0000-4000-8000-000000000001',false);
INSERT INTO public.politica_operacional_versoes(id,politica_operacional_id,versao,vigente_desde,
 aceite_sacado_obrigatorio,cessao_no_desembolso,cria_acompanhamento_entrega,configuracao,conteudo_hash,fundo_id,status,metodo_calculo_financeiro)
SELECT '27000000-0000-4000-8000-000000000002','26000000-0000-4000-8000-000000000002',1,now()-interval '1 day',
 aceite_sacado_obrigatorio,cessao_no_desembolso,cria_acompanhamento_entrega,configuracao,repeat('b',64),fundo_id,'rascunho',metodo_calculo_financeiro
FROM public.politica_operacional_versoes WHERE id='27000000-0000-4000-8000-000000000001';
INSERT INTO public.politica_requisitos_documentais(politica_operacional_versao_id,politica_operacional_id,fundo_id,
 codigo,escopo,momento_obrigatorio,tipo_documento_codigo,formatos_aceitos,nivel_validacao,responsavel_upload,responsavel_aprovacao)
VALUES('27000000-0000-4000-8000-000000000002','26000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001',
 'QA_R13_PDF','nf_pre_cessao','nf_pre_cessao','nf_danfe_pdf',ARRAY['pdf'],'manual','cedente','gestor');
UPDATE public.politica_operacional_versoes SET status='publicada',publicada_por='21000000-0000-4000-8000-000000000004',publicada_em=now()
WHERE id='27000000-0000-4000-8000-000000000002';
UPDATE public.cedente_fundo_politicas SET politica_operacional_id='26000000-0000-4000-8000-000000000002'
WHERE id='28000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',true);
SELECT public.instanciar_requisitos_nota(id,'26000000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000002')
FROM public.notas_fiscais WHERE id IN('2a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000002');
SELECT is((SELECT count(*)::int FROM public.documento_requisito_instancias),2,'document fixture contains two real requirement instances');
INSERT INTO public.operacoes(id,cedente_id,cedente_fundo_id,valor_bruto_total,prazo_dias,data_vencimento,status)
VALUES('2c000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',100000,30,current_date+30,'solicitada');
INSERT INTO public.operacoes_nfs(operacao_id,nota_fiscal_id)
VALUES('2c000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001');
INSERT INTO public.nota_fiscal_entregas(id,operacao_id,nota_fiscal_id,status_entrega)
VALUES('2d000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','em_transito');
INSERT INTO public.eventos_dominio(tenant_id,fundo_id,cedente_id,cedente_fundo_id,nota_fiscal_id,operacao_id,
 tipo_evento,categoria,ator_usuario_id,ator_nome_snapshot,ator_perfil_snapshot,origem,descricao,metadata,visibilidade)
SELECT '22000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',
 '23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001',
 op,'qa_r13_timeline','operacao','21000000-0000-4000-8000-000000000001','QA','consultor','qa_r13','QA event','{}','ambos'
FROM (VALUES(NULL::uuid),('2c000000-0000-4000-8000-000000000001'::uuid)) v(op);
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","aal":"aal2"}',true);
SET LOCAL ROLE authenticated;
SELECT ok(public.consultor_pode_visualizar_cedente('23000000-0000-4000-8000-000000000001'),'reader sees authorized cedente');
SELECT ok(public.consultor_pode_visualizar_operacao('2c000000-0000-4000-8000-000000000001'),'reader opens authorized operation');
SELECT ok(public.consultor_pode_visualizar_nota_fiscal('2a000000-0000-4000-8000-000000000001'),'reader sees operation NF');
SELECT ok(NOT public.consultor_pode_visualizar_nota_fiscal('2a000000-0000-4000-8000-000000000002'),'reader does not gain standalone NF access');
SELECT ok(public.logistica_usuario_pode_ler_entrega('2d000000-0000-4000-8000-000000000001'),'reader can read exact operation logistics');
SELECT is((SELECT count(*)::int FROM public.cedentes),1,'reader cedente RLS');
SELECT is((SELECT count(*)::int FROM public.operacoes),1,'reader operation RLS');
SELECT is((SELECT count(*)::int FROM public.operacoes_nfs),1,'reader operation NF RLS');
SELECT ok(EXISTS(SELECT 1 FROM public.documento_requisito_instancias WHERE nota_fiscal_id='2a000000-0000-4000-8000-000000000001'),'reader sees requirements for operation NF');
SELECT is((SELECT count(*)::int FROM public.documento_requisito_instancias WHERE nota_fiscal_id='2a000000-0000-4000-8000-000000000002'),0,'reader cannot see standalone NF requirements');
SELECT is((SELECT count(*)::int FROM public.eventos_dominio WHERE tipo_evento='qa_r13_timeline'),1,'reader only operation-bound events, never standalone NF event');
SELECT is((SELECT count(*)::int FROM public.listar_cedentes_visiveis_consultor()),1,'reader portfolio RPC');
SELECT is((SELECT count(*)::int FROM public.listar_fundos_visiveis_consultor()),1,'reader fund RPC');
SELECT is((public.dashboard_consultor_resumo()->>'cedentesTotal')::int,1,'reader dashboard still A6');
SELECT is((public.relatorio_consultor_analitico(to_char(now(),'YYYY-MM'))->>'total')::int,1,'reader report still A6');
SELECT ok(NOT (public.dashboard_consultor_resumo() ? 'comissaoEstimada'),'commission OFF remains masked');
SELECT ok(NOT private.consultor_usuario_pode_operar_cedente(auth.uid(),'23000000-0000-4000-8000-000000000001'),'reader does not become operator');
WITH changed AS(UPDATE public.notas_fiscais SET data_vencimento=current_date+90 WHERE id='2a000000-0000-4000-8000-000000000001' RETURNING id)
SELECT is((SELECT count(*)::int FROM changed),0,'reader cannot update NF');
WITH changed AS(UPDATE public.operacoes SET taxa_desconto=1 WHERE id='2c000000-0000-4000-8000-000000000001' RETURNING id)
SELECT is((SELECT count(*)::int FROM changed),0,'reader cannot update operation');
SELECT throws_ok($q$SELECT public.solicitar_operacao_antecipacao_consultor_atomica(
 '23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
 '26000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001',1,'{}'::jsonb,repeat('a',64),false,'dispensado',
 ARRAY['2a000000-0000-4000-8000-000000000002']::uuid[],2.5,repeat('b',64),NULL)$q$,
 'Consultor sem vinculo organizacional ativo com o Cedente informado','reader cannot submit operation');
SELECT throws_ok($q$SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',true)$q$,'42501',NULL,'reader cannot enable commission');
SELECT throws_ok($q$SELECT private.consultor_escopo_analitico()$q$,'42501',NULL,'reader cannot access raw analytics scope');
SELECT throws_ok($q$SELECT public.aprovar_operacao_com_risco_atomica('2c000000-0000-4000-8000-000000000001',2.5,NULL,repeat('a',64))$q$,
 'Somente gestor autenticado pode aprovar operacao','reader cannot approve operation');
SELECT throws_ok($q$INSERT INTO public.operacoes(cedente_id,cedente_fundo_id,valor_bruto_total,prazo_dias,data_vencimento,status)
 VALUES('23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',100,30,current_date+30,'solicitada')$q$,
 '42501',NULL,'reader cannot create operation directly');
RESET ROLE;
-- A second active fund for the same cedente is NOT implicitly authorized.
INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
VALUES('22000000-0000-4000-8000-000000000002','Outside QA','98000000000439','QA','98000000000277','QA','98000000000358',true);
INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id,status)
VALUES('24000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000002','ativo');
INSERT INTO public.operacoes(id,cedente_id,cedente_fundo_id,valor_bruto_total,prazo_dias,data_vencimento,status)
VALUES('2c000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000002',40000,30,current_date+30,'solicitada');
SET LOCAL ROLE authenticated;
SELECT ok(NOT public.consultor_pode_visualizar_operacao('2c000000-0000-4000-8000-000000000002'),'same cedente cross-fund operation denied');
SELECT is((SELECT count(*)::int FROM public.operacoes),1,'RLS excludes cross-fund operation');
RESET ROLE;
UPDATE public.consultor_fundos SET status='inativo';
SET LOCAL ROLE authenticated;
SELECT ok(NOT public.consultor_pode_visualizar_operacao('2c000000-0000-4000-8000-000000000001'),'revoked fund removes operation access');
SELECT is((SELECT count(*)::int FROM public.operacoes),0,'revoked fund RLS');
SELECT is((SELECT count(*)::int FROM public.listar_cedentes_visiveis_consultor()),0,'revoked fund removes portfolio');
RESET ROLE;
UPDATE public.consultor_fundos SET status='ativo';
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT ok(private.consultor_usuario_pode_operar_cedente(auth.uid(),'23000000-0000-4000-8000-000000000001'),'operator capability preserved');
SELECT ok(public.consultor_pode_visualizar_operacao('2c000000-0000-4000-8000-000000000001'),'operator reads operation');
SELECT is((SELECT count(*)::int FROM public.eventos_dominio WHERE tipo_evento='qa_r13_timeline'),2,'operator keeps pre-operation event read');
RESET ROLE;
UPDATE public.consultor_usuarios SET papel='OWNER' WHERE user_id='21000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT ok(private.consultor_usuario_pode_operar_cedente(auth.uid(),'23000000-0000-4000-8000-000000000001'),'owner capability preserved');
SELECT ok(public.consultor_pode_visualizar_operacao('2c000000-0000-4000-8000-000000000001'),'owner reads operation');
SELECT is((SELECT count(*)::int FROM public.eventos_dominio WHERE tipo_evento='qa_r13_timeline'),2,'owner keeps pre-operation event read');
SELECT throws_ok($q$SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',true)$q$,'42501',NULL,'owner cannot self-enable commission');
RESET ROLE;
SELECT ok(NOT has_function_privilege('service_role','public.dashboard_consultor_resumo()','EXECUTE'),'service dashboard remains denied');
SELECT ok(NOT has_function_privilege('service_role','private.dashboard_consultor_resumo_a6()','EXECUTE'),'service private analytics remains denied');
SELECT ok(NOT has_function_privilege('anon','public.consultor_pode_visualizar_operacao(uuid)','EXECUTE'),'anonymous operation gate denied');
SELECT ok(NOT has_function_privilege('service_role','public.listar_cedentes_visiveis_consultor(text,integer,integer)','EXECUTE'),'portfolio service grant not restored');
SELECT * FROM finish();
ROLLBACK;
