-- Synthetic only. Requires guibor_a5_a6.sql (or the equivalent native QA seed).
-- Run inside a rollback-only transaction, never against a shared environment.
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('51000000-0000-4000-8000-000000000001','sacado-hotfix-sql-a@example.invalid','{}','{}',now(),now()),
 ('51000000-0000-4000-8000-000000000002','sacado-hotfix-sql-b@example.invalid','{}','{}',now(),now());
UPDATE public.profiles SET role='sacado',status='ativo'
 WHERE id IN ('51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002');
INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
VALUES ('52000000-0000-4000-8000-000000000001','Outro Fundo QA Sacado','98765000000190','Administradora QA','98000000000277','Gestora QA','98000000000358',true);
INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id,status)
VALUES ('53000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','ativo');
INSERT INTO public.sacados(id,cnpj,razao_social) VALUES
 ('54000000-0000-4000-8000-000000000001','11.344.038/0021-41','Sacado QA A'),
 ('54000000-0000-4000-8000-000000000002','11344038002060','Sacado QA B');
INSERT INTO public.sacado_acessos(user_id,sacado_id,fundo_id) VALUES
 ('51000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001'),
 ('51000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001'),
 ('51000000-0000-4000-8000-000000000002','54000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001');

INSERT INTO public.operacoes(id,cedente_id,cedente_fundo_id,valor_bruto_total,prazo_dias,data_vencimento,status,aceite_sacado_exigido,aceite_sacado_status)
SELECT ('55000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '23000000-0000-4000-8000-000000000001',
 CASE WHEN n IN (4,5) THEN '53000000-0000-4000-8000-000000000001'::uuid ELSE '24000000-0000-4000-8000-000000000001'::uuid END,
 CASE WHEN n=1 THEN 500 ELSE 100 END,30,current_date+30,
 (CASE WHEN n IN (2,4,5,6) THEN 'em_andamento' WHEN n=7 THEN 'cancelada' ELSE 'solicitada' END)::public.operacao_status,
 true,CASE WHEN n IN (2,4,5,6) THEN 'aceito' ELSE 'pendente' END
FROM generate_series(1,7) n;

INSERT INTO public.notas_fiscais(id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,valor_liquido_origem,status)
SELECT ('56000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '23000000-0000-4000-8000-000000000001',
 CASE WHEN n IN (8,9) THEN '53000000-0000-4000-8000-000000000001'::uuid ELSE '24000000-0000-4000-8000-000000000001'::uuid END,
 CASE WHEN n IN (8,9) THEN '52000000-0000-4000-8000-000000000001'::uuid ELSE '22000000-0000-4000-8000-000000000001'::uuid END,
 'SACADO-HOTFIX-'||n,'QA',current_date,current_date+30,'98100000000168','Cedente QA',
 CASE WHEN n IN (7,8) THEN '11344038002060' WHEN n=10 THEN '11.344.038/0021-41' ELSE '11344038002141' END,
 'Sacado QA',100,100,'LEGACY_BRUTO','em_antecipacao'
FROM generate_series(1,10) n;
INSERT INTO public.operacoes_nfs(operacao_id,nota_fiscal_id)
SELECT ('55000000-0000-4000-8000-'||lpad((CASE WHEN n<=5 THEN 1 WHEN n=6 THEN 2 WHEN n=7 THEN 3 WHEN n=8 THEN 4 WHEN n=9 THEN 5 ELSE 6 END)::text,12,'0'))::uuid,
 ('56000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
FROM generate_series(1,10) n;
-- Historical canceled link must not prevent a current decision or double count.
INSERT INTO public.operacoes_nfs(operacao_id,nota_fiscal_id) VALUES
 ('55000000-0000-4000-8000-000000000007','56000000-0000-4000-8000-000000000001');
