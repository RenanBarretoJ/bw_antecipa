-- Requires fixtures/sacado_hotfix.sql; local rollback-only QA.
SELECT no_plan();
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT ok(NOT EXISTS (
  SELECT 1 FROM public.operacoes_nfs l
  WHERE private.sacado_tem_acesso_operacao_nf(l.operacao_id,l.nota_fiscal_id)
    IS DISTINCT FROM EXISTS (SELECT 1 FROM private.sacado_vinculos_autorizados() v WHERE v.operacao_id=l.operacao_id AND v.nota_fiscal_id=l.nota_fiscal_id)
),'New authorization set exactly matches existing per-link authorization');
SELECT ok(NOT has_function_privilege('anon','private.sacado_vinculos_autorizados()','EXECUTE'),'Anonymous cannot execute private lookup');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.carregar_dashboard_sacado(text)'::regprocedure),'Dashboard remains SECURITY INVOKER');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.notas_fiscais WHERE numero_nf LIKE 'SACADO-HOTFIX-%'),8,'Exact CNPJ/fund pairs, including formatted CNPJ');
SELECT is((SELECT count(*)::int FROM public.operacoes WHERE id::text LIKE '55000000%'),5,'Only operations with an authorized coherent link');
SELECT is((SELECT count(*)::int FROM public.operacoes_nfs WHERE operacao_id::text LIKE '55000000%'),9,'No cross-fund link or cross-product authorization');
SELECT is((public.carregar_dashboard_sacado()->'indicadores'->>'nfsAtivas')::int,3,'Dashboard counts latest active operation only');
SELECT is((public.carregar_dashboard_sacado()->'indicadores'->>'totalDevido')::numeric,300::numeric,'Dashboard preserves gross-value projection');
SELECT is((public.carregar_dashboard_sacado('11344038002141')->'indicadores'->>'nfsAtivas')::int,2,'Dashboard CNPJ filter narrows scope');
SELECT is((public.carregar_dashboard_sacado('99999999999999')->'indicadores'->>'nfsAtivas')::int,0,'Dashboard cannot expand scope via arbitrary CNPJ');
SELECT throws_ok($$SELECT public.processar_aceite_sacado(ARRAY['56000000-0000-4000-8000-000000000001'::uuid,'56000000-0000-4000-8000-000000000007'::uuid],'contestar','QA')$$,'42501','Esta NF nao esta autorizada para este usuario e Fundo.','Unauthorized batch fails atomically');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.logs_auditoria WHERE origem='rpc_sacado' AND entidade_id::text LIKE '56000000%' AND usuario_id='51000000-0000-4000-8000-000000000001'),0,'Rejected batch has no audit side effects');
SELECT is((SELECT status::text FROM public.notas_fiscais WHERE id='56000000-0000-4000-8000-000000000001'),'em_antecipacao','Rejected batch leaves authorized NF unchanged');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.processar_aceite_sacado(ARRAY['56000000-0000-4000-8000-000000000001'::uuid],'contestar','QA individual')$$,'Single contestation with canceled historical link');
RESET ROLE;
SELECT is((SELECT aceite_sacado_status FROM public.operacoes WHERE id='55000000-0000-4000-8000-000000000001'),'contestado','Operation remains contested for Gestor');
SELECT is((SELECT count(*)::int FROM public.notas_fiscais WHERE id::text LIKE '56000000%' AND status='em_antecipacao'),9,'Contesting one NF does not decide others');
SET LOCAL ROLE authenticated;
SELECT ok(EXISTS(SELECT 1 FROM public.listar_cedentes_aprovacao_sacado() c WHERE c.id='23000000-0000-4000-8000-000000000001'),'Cedente filter retains partially contested operation');
SELECT lives_ok($$SELECT public.processar_aceite_sacado(ARRAY['56000000-0000-4000-8000-000000000002'::uuid,'56000000-0000-4000-8000-000000000003'::uuid],'contestar','QA shared reason')$$,'Batch contestation continues after partial contestation');
SELECT lives_ok($$SELECT public.processar_aceite_sacado(ARRAY['56000000-0000-4000-8000-000000000004'::uuid],'aceitar')$$,'Remaining NF can still be accepted');
SELECT throws_ok($$SELECT public.processar_aceite_sacado(ARRAY['56000000-0000-4000-8000-000000000005'::uuid,'56000000-0000-4000-8000-000000000001'::uuid],'contestar','QA replay')$$,'P0001',NULL,'Mixed pending/decided batch is rejected');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.notas_fiscais WHERE id IN ('56000000-0000-4000-8000-000000000002','56000000-0000-4000-8000-000000000003') AND status='contestada' AND motivo_ajuste='QA shared reason'),2,'Shared reason is persisted on both selected NFs');
SELECT is((SELECT status::text FROM public.notas_fiscais WHERE id='56000000-0000-4000-8000-000000000005'),'em_antecipacao','Atomic rejection preserves remaining pending NF');
SELECT is((SELECT aceite_sacado_status FROM public.operacoes WHERE id='55000000-0000-4000-8000-000000000001'),'contestado','Partial acceptance never clears existing contestation');
SELECT is((SELECT status::text FROM public.operacoes WHERE id='55000000-0000-4000-8000-000000000007'),'cancelada','Historical canceled operation is preserved');
SELECT is((SELECT count(*)::int FROM public.logs_auditoria WHERE origem='rpc_sacado' AND entidade_id::text LIKE '56000000%' AND usuario_id='51000000-0000-4000-8000-000000000001'),4,'One audited decision per NF; rejected replay has no side effects');
SELECT ok(NOT has_table_privilege('authenticated','public.sacado_acessos','UPDATE'),'No direct membership writes granted');
UPDATE public.sacado_acessos SET status='inativo' WHERE user_id='51000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.notas_fiscais WHERE numero_nf LIKE 'SACADO-HOTFIX-%'),0,'Membership deactivation takes effect without token refresh');
SELECT is((public.carregar_dashboard_sacado()->'indicadores'->>'totalDevido')::numeric,0::numeric,'Deactivated membership returns empty dashboard');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.notas_fiscais WHERE numero_nf LIKE 'SACADO-HOTFIX-%'),1,'Another Sacado retains only its authorized CNPJ/fund');
SELECT throws_ok($$SELECT public.processar_aceite_sacado(ARRAY['56000000-0000-4000-8000-000000000005'::uuid],'aceitar')$$,'42501','Esta NF nao esta autorizada para este usuario e Fundo.','Other Sacado cannot decide remaining NF');
RESET ROLE;
UPDATE public.profiles SET status='inativo' WHERE id='51000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM private.sacado_vinculos_autorizados()),0,'Inactive profile cannot use authorization set');
SELECT is((public.carregar_dashboard_sacado()->'indicadores'->>'nfsAtivas')::int,0,'Inactive profile has no dashboard data');
RESET ROLE;
SELECT * FROM finish();
