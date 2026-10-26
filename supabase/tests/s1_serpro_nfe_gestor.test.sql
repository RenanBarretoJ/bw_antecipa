\set ON_ERROR_STOP on

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

-- Test harness only: role switching below must retain access to pgTAP's
-- assertion functions. The transaction is rolled back, so these grants never
-- become part of the application ACLs.
GRANT USAGE ON SCHEMA extensions TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated, anon;

SELECT plan(22);

DO $fixture$
DECLARE
  v_gestor_a uuid := '91000000-0000-4000-8000-000000000001';
  v_gestor_b uuid := '91000000-0000-4000-8000-000000000002';
  v_cedente_user uuid := '91000000-0000-4000-8000-000000000003';
  v_consultor uuid := '91000000-0000-4000-8000-000000000004';
  v_sacado uuid := '91000000-0000-4000-8000-000000000005';
  v_admin uuid := '91000000-0000-4000-8000-000000000006';
  v_fundo_a uuid := '92000000-0000-4000-8000-000000000001';
  v_fundo_b uuid := '92000000-0000-4000-8000-000000000002';
  v_cedente uuid := '93000000-0000-4000-8000-000000000001';
  v_vinculo uuid := '94000000-0000-4000-8000-000000000001';
  v_vinculo_b uuid := '94000000-0000-4000-8000-000000000002';
BEGIN
  INSERT INTO auth.users (id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES
    (v_gestor_a,'s1-gestor-a@example.invalid','{}','{"nome_completo":"S1 Gestor A"}',now(),now()),
    (v_gestor_b,'s1-gestor-b@example.invalid','{}','{"nome_completo":"S1 Gestor B"}',now(),now()),
    (v_cedente_user,'s1-cedente@example.invalid','{}','{"nome_completo":"S1 Cedente"}',now(),now()),
    (v_consultor,'s1-consultor@example.invalid','{}','{"nome_completo":"S1 Consultor"}',now(),now()),
    (v_sacado,'s1-sacado@example.invalid','{}','{"nome_completo":"S1 Sacado"}',now(),now()),
    (v_admin,'s1-admin@example.invalid','{}','{"nome_completo":"S1 Admin"}',now(),now());

  INSERT INTO public.profiles (id,role,nome_completo,email,status) VALUES
    (v_gestor_a,'gestor','S1 Gestor A','s1-gestor-a@example.invalid','ativo'),
    (v_gestor_b,'gestor','S1 Gestor B','s1-gestor-b@example.invalid','ativo'),
    (v_cedente_user,'cedente','S1 Cedente','s1-cedente@example.invalid','ativo'),
    (v_consultor,'consultor','S1 Consultor','s1-consultor@example.invalid','ativo'),
    (v_sacado,'sacado','S1 Sacado','s1-sacado@example.invalid','ativo'),
    (v_admin,'super_admin','S1 Admin','s1-admin@example.invalid','ativo')
  ON CONFLICT (id) DO UPDATE SET role=excluded.role,status=excluded.status;

  -- Super Admin is a complementary canonical grant, not only a profile role.
  INSERT INTO public.usuario_papeis (usuario_id,papel,ativo,origem)
  VALUES (v_admin,'super_admin',true,'administracao')
  ON CONFLICT (usuario_id,papel) DO UPDATE
    SET ativo=true,origem='administracao',revogado_em=NULL;

  INSERT INTO public.fundos (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
  VALUES
    (v_fundo_a,'Fundo S1 A','91000000000101','Admin A','91000000000292','Gestora A','91000000000373',true),
    (v_fundo_b,'Fundo S1 B','92000000000198','Admin B','92000000000279','Gestora B','92000000000350',true);
  INSERT INTO public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal)
  VALUES (v_gestor_a,v_fundo_a,'gestor','ativo',true),(v_gestor_b,v_fundo_b,'gestor','ativo',true);
  INSERT INTO public.cedentes (id,user_id,cnpj,razao_social,status,fundo_id)
  VALUES (v_cedente,v_cedente_user,'14224864000100','Cedente S1','ativo',v_fundo_a);
  INSERT INTO public.cedente_fundos (id,cedente_id,fundo_id,status)
  VALUES
    (v_vinculo,v_cedente,v_fundo_a,'ativo'),
    (v_vinculo_b,v_cedente,v_fundo_b,'ativo');

  INSERT INTO public.notas_fiscais (
    id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,chave_acesso,
    data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,
    cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,
    status,tipo_documento_fiscal,fiscal_proveniencia,valor_liquido_origem,vencimento_origem
  ) VALUES
    ('95000000-0000-4000-8000-000000000001',v_cedente,v_vinculo,v_fundo_a,'2190','2',
     '35261014224864000100550020000021901123456788','2026-10-20','2026-11-20',
     '14224864000100','Cedente S1','12345678000190','Sacado S1',71057,71057,
     'submetida','NFE','{"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',NULL,NULL),
    ('95000000-0000-4000-8000-000000000002',v_cedente,v_vinculo,v_fundo_a,'NFS1','1','12345678901234567890123456789012345678901234567890',
     '2026-10-20','2026-11-20','14224864000100','Cedente S1','12345678000190','Sacado S1',100,100,
     'submetida','NFSE','{"strategy":"danfse_v2_labels","source":"PDF_TEXT_NATIVE","competencia":"2026-10","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","vencimento_documento":"2026-11-20"}','DOCUMENTO_EXPLICITO','DOCUMENT'),
    ('95000000-0000-4000-8000-000000000003',v_cedente,v_vinculo,v_fundo_a,'2191','2',NULL,
     '2026-10-20','2026-11-20','14224864000100','Cedente S1','12345678000190','Sacado S1',200,200,
     'submetida','NFE','{}',NULL,NULL);
END
$fixture$;

SELECT is((SELECT count(*)::integer FROM public.nfe_fiscal_snapshots), 2, 'NFS-e não cria snapshot S1');
SELECT is((SELECT status FROM public.nfe_fiscal_consultas WHERE nota_fiscal_id='95000000-0000-4000-8000-000000000001'), 'PENDENTE', 'NF-e válida é enfileirada');
SELECT is((SELECT status FROM public.nfe_fiscal_consultas WHERE nota_fiscal_id='95000000-0000-4000-8000-000000000003'), 'AGUARDANDO_CHAVE', 'PDF sem chave segura aguarda chave');
SELECT is((SELECT capability_state FROM public.nfe_fiscal_consultas WHERE nota_fiscal_id='95000000-0000-4000-8000-000000000001'), 'UNVERIFIED', 'capacidade inicia não verificada');

UPDATE public.notas_fiscais SET status='em_analise' WHERE id='95000000-0000-4000-8000-000000000001';
UPDATE public.notas_fiscais SET status='submetida' WHERE id='95000000-0000-4000-8000-000000000001';
SELECT is((SELECT count(*)::integer FROM public.nfe_fiscal_snapshots WHERE nota_fiscal_id='95000000-0000-4000-8000-000000000001'), 1, 'repetição não duplica snapshot');

SELECT throws_ok(
  $$UPDATE public.nfe_fiscal_snapshots SET numero_nf='alterado' WHERE nota_fiscal_id='95000000-0000-4000-8000-000000000001'$$,
  '55000', 'Snapshot fiscal é imutável', 'snapshot é imutável inclusive para owner'
);

SELECT throws_ok(
  $$INSERT INTO public.notas_fiscais (
      id,cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,chave_acesso,
      data_emissao,data_vencimento,cnpj_emitente,razao_social_emitente,
      cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,
      status,tipo_documento_fiscal,fiscal_proveniencia
    ) VALUES (
      '95000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002',
      '2190','2','35261014224864000100550020000021901123456788','2026-10-20','2026-11-20',
      '14224864000100','Cedente S1','12345678000190','Sacado S1',71057,71057,
      'submetida','NFE','{"sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'
    )$$,
  '23505', NULL,
  'mesma chave fiscal em outro Fundo é rejeitada pela identidade canônica global antes da fila S1'
);

SET LOCAL ROLE authenticated;
SET LOCAL search_path = extensions, public;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
SELECT is((SELECT count(*)::integer FROM public.nfe_fiscal_consultas), 2, 'Gestor A lê somente seu Fundo');
SELECT is((SELECT count(*)::integer FROM public.nfe_fiscal_eventos), 0, 'Gestor não recebe eventos inexistentes');
SELECT is((public.solicitar_reconsulta_nfe_fiscal('95000000-0000-4000-8000-000000000001')->>'code'), 'CAPABILITY_UNVERIFIED', 'reconsulta não ativa capacidade não comprovada');
SELECT throws_ok(
  $$INSERT INTO public.nfe_fiscal_consultas(snapshot_id,fundo_id,nota_fiscal_id,status) VALUES(gen_random_uuid(),'92000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000001','PENDENTE')$$,
  '42501', NULL, 'Gestor não escreve diretamente na fila'
);
SELECT throws_ok(
  $$SELECT public.obter_nfe_identidade_fiscal_admin('95000000-0000-4000-8000-000000000001')$$,
  '42501', 'Acesso fiscal administrativo negado', 'Gestor não usa RPC privativa do Super Admin'
);

SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
SELECT is((SELECT count(*)::integer FROM public.nfe_fiscal_consultas), 0, 'Gestor B não lê Fundo A');
SELECT throws_ok(
  $$SELECT public.obter_situacao_fiscal_nfe('95000000-0000-4000-8000-000000000001')$$,
  '42501', 'Acesso fiscal negado', 'Gestor B não usa RPC cross-fund'
);

SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
SELECT is((SELECT count(*)::integer FROM public.nfe_fiscal_consultas), 0, 'Cedente não lê consulta');
SELECT throws_ok(
  $$SELECT public.obter_situacao_fiscal_nfe('95000000-0000-4000-8000-000000000001')$$,
  '42501', 'Acesso fiscal negado', 'Cedente não usa RPC fiscal'
);

SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000004',true);
SELECT is((SELECT count(*)::integer FROM public.nfe_fiscal_consultas), 0, 'Consultor não lê consulta');
SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000005',true);
SELECT is((SELECT count(*)::integer FROM public.nfe_fiscal_consultas), 0, 'Sacado não lê consulta');

SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000006',true);
SELECT is((SELECT count(*)::integer FROM public.nfe_fiscal_consultas), 2, 'Super Admin lê consultas privadas');
SELECT ok(public.obter_situacao_fiscal_nfe('95000000-0000-4000-8000-000000000001') IS NOT NULL, 'Super Admin usa view-model minimizado');
SELECT is(
  public.obter_nfe_identidade_fiscal_admin('95000000-0000-4000-8000-000000000001')->>'numeroNf',
  '2190',
  'Super Admin lê somente a identidade fiscal minimizada pela RPC dedicada'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',true);
SELECT throws_ok(
  $$SELECT count(*) FROM public.nfe_fiscal_consultas$$,
  '42501', NULL, 'Anônimo não possui ACL de leitura'
);

SELECT * FROM finish();
ROLLBACK;
