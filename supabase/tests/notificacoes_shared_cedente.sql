-- Executed by scripts/qa/notificacoes/shared-cadastro.test.mjs inside ROLLBACK.
-- Fixture A already exists. B shares the Cedente; C has no canonical link.
INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
VALUES ('22000000-0000-4000-8000-000000000002','QA B','98000000000439','QA','98000000000277','QA','98000000000358',true),
       ('22000000-0000-4000-8000-000000000003','QA C','98000000000510','QA','98000000000277','QA','98000000000358',true);
INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id,status)
VALUES ('24000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000002','ativo');

INSERT INTO auth.users(id,email,raw_user_meta_data)
SELECT ('21000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'qa-notif-'||n||'@example.invalid','{}'::jsonb
FROM generate_series(10,14) n;
UPDATE public.profiles SET role='gestor',status='ativo'
WHERE id IN (SELECT ('21000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(10,14) n);
-- 10: only B, 11: only C, 12: no fund, 13: inactive profile in A, 14: inactive membership A.
INSERT INTO public.usuario_fundos(usuario_id,fundo_id,status) VALUES
('21000000-0000-4000-8000-000000000010','22000000-0000-4000-8000-000000000002','ativo'),
('21000000-0000-4000-8000-000000000011','22000000-0000-4000-8000-000000000003','ativo'),
('21000000-0000-4000-8000-000000000013','22000000-0000-4000-8000-000000000001','ativo'),
('21000000-0000-4000-8000-000000000014','22000000-0000-4000-8000-000000000001','suspenso'),
('21000000-0000-4000-8000-000000000004','22000000-0000-4000-8000-000000000002','ativo');
UPDATE public.profiles SET status='inativo' WHERE id='21000000-0000-4000-8000-000000000013';

SELECT plan(25);
SELECT ok(NOT has_function_privilege('anon','public.notificar_gestores_cadastro_cedente(uuid,text,text,text,text)','EXECUTE'),'anon cannot broadcast');
SELECT ok(NOT has_function_privilege('authenticated','public.notificar_gestores_cadastro_cedente(uuid,text,text,text,text)','EXECUTE'),'authenticated cannot broadcast');
SELECT ok(NOT has_function_privilege('authenticated','private.notificar_gestores_cadastro_cedente(uuid,text,text,text,text)','EXECUTE'),'private producer inaccessible to authenticated');
SELECT ok(has_function_privilege('service_role','public.notificar_gestores_cadastro_cedente(uuid,text,text,text,text)','EXECUTE'),'trusted backend can invoke');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.notificar_gestores_cadastro_cedente(uuid,text,text,text,text)'::regprocedure),'public wrapper is invoker');

SET LOCAL ROLE service_role;
SELECT is(public.notificar_gestores_cadastro_cedente('23000000-0000-4000-8000-000000000001','QA','Documento atualizado','documento_enviado','upload:1'),3,'A/B recipient matrix: two contexts for multifund gestor, one for B gestor');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notificacoes WHERE scope_type='FUNDO'),3::bigint,'three scoped rows');
SELECT is((SELECT count(*) FROM public.notificacoes WHERE fundo_id='22000000-0000-4000-8000-000000000001'),1::bigint,'A has only its gestor');
SELECT is((SELECT count(*) FROM public.notificacoes WHERE fundo_id='22000000-0000-4000-8000-000000000002'),2::bigint,'B has both authorized gestores');
SELECT is((SELECT count(*) FROM public.notificacoes WHERE fundo_id='22000000-0000-4000-8000-000000000003'),0::bigint,'unlinked C gets nothing');
SELECT is((SELECT count(*) FROM public.notificacoes WHERE usuario_id IN ('21000000-0000-4000-8000-000000000012','21000000-0000-4000-8000-000000000013','21000000-0000-4000-8000-000000000014')),0::bigint,'unassigned/inactive recipients excluded');
SELECT ok((SELECT bool_and(n.cedente_id=cf.cedente_id AND n.fundo_id=cf.fundo_id AND n.entidade_tipo='cedente_fundo' AND n.entidade_id=cf.id) FROM public.notificacoes n JOIN public.cedente_fundos cf ON cf.id=n.cedente_fundo_id WHERE n.scope_type='FUNDO'),'entity and canonical link coherent');
SELECT ok((SELECT bool_and(dedupe_key LIKE 'fund:'||fundo_id::text||':%:user:'||usuario_id::text) FROM public.notificacoes WHERE scope_type='FUNDO'),'dedupe contains fund and user');
SELECT is(public.notificar_gestores_cadastro_cedente('23000000-0000-4000-8000-000000000001','QA','Documento atualizado','documento_enviado','upload:1'),0,'retry does not duplicate');
SELECT is(public.notificar_gestores_cadastro_cedente('23000000-0000-4000-8000-000000000001','QA','Documento atualizado','documento_enviado','upload:2'),3,'new version creates distinct event');

UPDATE public.cedente_fundos SET vigente_desde=now()-interval '2 days',vigente_ate=now()-interval '1 second' WHERE id='24000000-0000-4000-8000-000000000002';
SELECT is(public.notificar_gestores_cadastro_cedente('23000000-0000-4000-8000-000000000001','QA','Documento atualizado','documento_enviado','upload:3'),1,'expired B link excluded');
UPDATE public.cedente_fundos SET vigente_ate=NULL,status='suspenso' WHERE id='24000000-0000-4000-8000-000000000002';
SELECT is(public.notificar_gestores_cadastro_cedente('23000000-0000-4000-8000-000000000001','QA','Documento atualizado','documento_enviado','upload:4'),1,'suspended B link excluded');
UPDATE public.cedente_fundos SET status='ativo',vigente_desde=now()+interval '1 day' WHERE id='24000000-0000-4000-8000-000000000002';
SELECT is(public.notificar_gestores_cadastro_cedente('23000000-0000-4000-8000-000000000001','QA','Documento atualizado','documento_enviado','upload:5'),1,'future B link excluded');
UPDATE public.cedente_fundos SET vigente_desde=now()-interval '1 day' WHERE id='24000000-0000-4000-8000-000000000002';
UPDATE public.fundos SET ativo=false WHERE id='22000000-0000-4000-8000-000000000002';
SELECT is(public.notificar_gestores_cadastro_cedente('23000000-0000-4000-8000-000000000001','QA','Documento atualizado','documento_enviado','upload:6'),1,'inactive B fund excluded');
UPDATE public.cedente_fundos SET status='suspenso' WHERE cedente_id='23000000-0000-4000-8000-000000000001';
SELECT is(public.notificar_gestores_cadastro_cedente('23000000-0000-4000-8000-000000000001','QA','Documento atualizado','documento_enviado','upload:7'),0,'no active link: no fallback broadcast');
SELECT throws_ok($q$SELECT public.notificar_gestores_cadastro_cedente('23000000-0000-4000-8000-999999999999','QA','QA','documento_enviado','x')$q$,'22023','NOTIFICACAO_CEDENTE_INVALIDO','invalid Cedente denied');
SELECT throws_ok($q$SELECT public.notificar_gestores_cadastro_cedente('23000000-0000-4000-8000-000000000001','QA','QA','nf_submetida','x')$q$,'22023','NOTIFICACAO_EVENTO_CADASTRAL_INVALIDO','operational NF cannot use shared routing');
SELECT throws_ok($q$SELECT public.notificar_gestores_cadastro_cedente('23000000-0000-4000-8000-000000000001','QA','QA','documento_enviado',' ')$q$,'22023','NOTIFICACAO_EVENTO_CADASTRAL_INVALIDO','missing event key denied');
SELECT throws_ok($q$SELECT public.notificar_gestores_cadastro_cedente('23000000-0000-4000-8000-000000000001','QA','QA',NULL,'x')$q$,'22023','NOTIFICACAO_EVENTO_CADASTRAL_INVALIDO','missing event type denied');
SELECT is((SELECT count(*) FROM public.notificacoes WHERE scope_type='GLOBAL'),0::bigint,'shared business events never become GLOBAL');
SELECT * FROM finish();
