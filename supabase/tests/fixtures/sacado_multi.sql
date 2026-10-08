-- Synthetic actors and invoices, local rollback-only. No production rows copied.
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('31000000-0000-4000-8000-000000000001','sacado-a@example.invalid','{}','{}',now(),now()),
 ('31000000-0000-4000-8000-000000000002','sacado-b@example.invalid','{}','{}',now(),now());
UPDATE public.profiles SET role='sacado',status='ativo' WHERE id IN ('31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002');
INSERT INTO public.sacados(id,user_id,cnpj,razao_social) VALUES
 ('32000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','11.344.038/0021-41','Empresa QA 0021');
UPDATE public.notas_fiscais SET cnpj_destinatario=CASE
 WHEN id='2a000000-0000-4000-8000-000000000001' THEN '11344038002141'
 WHEN id='2a000000-0000-4000-8000-000000000002' THEN '11344038002060'
 WHEN id='2a000000-0000-4000-8000-000000000003' THEN '11344038009910'
 ELSE '11344038002141' END, status='em_antecipacao';
INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
VALUES('22000000-0000-4000-8000-000000000002','Outro Fundo QA','98000000000439','Administradora QA','98000000000277','Gestora QA','98000000000358',true);
INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id,status) VALUES
 ('24000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000002','ativo');
-- Cross-fund invoice is inserted after the legacy backfill in assertions, to keep
-- the reviewed legacy evidence unambiguous in the upgrade rehearsal.
INSERT INTO public.operacoes(id,cedente_id,cedente_fundo_id,valor_bruto_total,prazo_dias,data_vencimento,status,aceite_sacado_exigido,aceite_sacado_status)
VALUES('33000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',139521.98,30,current_date+30,'solicitada',true,'pendente'),
 ('33000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',112710.81,30,current_date+30,'solicitada',true,'pendente');
INSERT INTO public.operacoes_nfs(operacao_id,nota_fiscal_id) VALUES
 ('33000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001'),
 ('33000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000002'),
 ('33000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000003');
