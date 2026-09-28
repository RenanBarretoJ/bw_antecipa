\set ON_ERROR_STOP on

BEGIN;

SELECT plan(8);

DO $test$
DECLARE
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_operador uuid := '10000000-0000-4000-8000-000000000002';
  v_leitor uuid := '10000000-0000-4000-8000-000000000003';
  v_inativo uuid := '10000000-0000-4000-8000-000000000004';
  v_carlos uuid := '10000000-0000-4000-8000-000000000005';
  v_xpto uuid := '20000000-0000-4000-8000-000000000001';
  v_acme uuid := '20000000-0000-4000-8000-000000000002';
  v_rlx uuid := '30000000-0000-4000-8000-000000000001';
  v_health uuid := '30000000-0000-4000-8000-000000000002';
  v_alfa uuid := '40000000-0000-4000-8000-000000000001';
  v_beta uuid := '40000000-0000-4000-8000-000000000002';
  v_gama uuid := '40000000-0000-4000-8000-000000000003';
  v_alfa_cf uuid := '50000000-0000-4000-8000-000000000001';
  v_alfa_estabelecimento uuid := '60000000-0000-4000-8000-000000000001';
  v_nf_alfa uuid := '70000000-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_owner, 'owner-c11@example.invalid', '{}'::jsonb, '{"nome_completo":"Owner C11"}'::jsonb, now(), now()),
    (v_operador, 'operador-c11@example.invalid', '{}'::jsonb, '{"nome_completo":"Operador C11"}'::jsonb, now(), now()),
    (v_leitor, 'leitor-c11@example.invalid', '{}'::jsonb, '{"nome_completo":"Leitor C11"}'::jsonb, now(), now()),
    (v_inativo, 'inativo-c11@example.invalid', '{}'::jsonb, '{"nome_completo":"Inativo C11"}'::jsonb, now(), now()),
    (v_carlos, 'carlos-c11@example.invalid', '{}'::jsonb, '{"nome_completo":"Carlos C11"}'::jsonb, now(), now());

  INSERT INTO public.profiles (id, role, nome_completo, email, status)
  VALUES
    (v_owner, 'consultor', 'Owner C11', 'owner-c11@example.invalid', 'ativo'),
    (v_operador, 'consultor', 'Operador C11', 'operador-c11@example.invalid', 'ativo'),
    (v_leitor, 'consultor', 'Leitor C11', 'leitor-c11@example.invalid', 'ativo'),
    (v_inativo, 'consultor', 'Inativo C11', 'inativo-c11@example.invalid', 'ativo'),
    (v_carlos, 'consultor', 'Carlos C11', 'carlos-c11@example.invalid', 'ativo')
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles SET role = 'consultor'::public.user_role, status = 'ativo'::public.user_status
  WHERE id IN (v_owner, v_operador, v_leitor, v_inativo, v_carlos);

  INSERT INTO public.fundos (
    id, nome, cnpj, administradora_nome, administradora_cnpj,
    gestora_nome, gestora_cnpj, ativo
  ) VALUES
    (v_rlx, 'RLX C1.1', '98000000000196', 'Admin RLX', '98000000000277', 'Gestora RLX', '98000000000358', true),
    (v_health, 'HEALTH C1.1', '98000000000439', 'Admin HEALTH', '98000000000510', 'Gestora HEALTH', '98000000000609', true);

  INSERT INTO public.cedentes (id, cnpj, razao_social, status, fundo_id)
  VALUES
    (v_alfa, '98100000000168', 'Cedente Alfa C1.1', 'ativo'::public.cedente_status, v_rlx),
    (v_beta, '98100000000249', 'Cedente Beta C1.1', 'ativo'::public.cedente_status, v_health),
    (v_gama, '98100000000320', 'Cedente Gama C1.1', 'ativo'::public.cedente_status, v_health);

  INSERT INTO public.cedente_fundos (id, cedente_id, fundo_id, status)
  VALUES (v_alfa_cf, v_alfa, v_rlx, 'ativo');
  INSERT INTO public.cedente_fundos (cedente_id, fundo_id, status)
  VALUES (v_beta, v_health, 'ativo'), (v_gama, v_health, 'ativo');

  SELECT id
  INTO v_alfa_estabelecimento
  FROM public.cedente_estabelecimentos
  WHERE cedente_id = v_alfa
    AND cnpj = '98100000000168';

  INSERT INTO public.notas_fiscais (
    id, cedente_id, cedente_fundo_id, fundo_id, estabelecimento_id,
    numero_nf, serie, data_emissao, data_vencimento,
    cnpj_emitente, razao_social_emitente,
    cnpj_destinatario, razao_social_destinatario,
    valor_bruto, valor_liquido, status
  ) VALUES (
    v_nf_alfa, v_alfa, v_alfa_cf, v_rlx, v_alfa_estabelecimento,
    'C11-EVENT-1', '1', current_date, current_date + 30,
    '98100000000168', 'Cedente Alfa C1.1',
    '98300000000101', 'Sacado Sintetico C1.1',
    100, 100, 'rascunho'::public.nf_status
  );

  INSERT INTO public.consultores (id, cnpj, razao_social, status)
  VALUES
    (v_xpto, '98200000000130', 'XPTO Consultoria C1.1', 'ativo'),
    (v_acme, '98200000000210', 'ACME Consultoria C1.1', 'ativo');

  INSERT INTO public.consultor_usuarios (consultor_id, user_id, papel, status, ativado_em, desativado_em)
  VALUES
    (v_xpto, v_owner, 'OWNER', 'ativo', now(), null),
    (v_xpto, v_operador, 'OPERADOR', 'ativo', now(), null),
    (v_xpto, v_leitor, 'LEITOR', 'ativo', now(), null),
    (v_xpto, v_inativo, 'OPERADOR', 'inativo', now(), now()),
    (v_acme, v_carlos, 'OWNER', 'ativo', now(), null);

  INSERT INTO public.consultor_fundos (consultor_id, fundo_id, status)
  VALUES (v_xpto, v_rlx, 'ativo'), (v_acme, v_health, 'ativo');
  INSERT INTO public.consultor_cedentes (consultor_id, cedente_id, status)
  VALUES (v_xpto, v_alfa, 'ativo'), (v_xpto, v_beta, 'ativo'), (v_acme, v_gama, 'ativo');

  IF (SELECT count(*) FROM public.consultor_cedentes WHERE consultor_id = v_xpto) <> 2 THEN
    RAISE EXCEPTION 'carteira foi duplicada por usuario';
  END IF;
  IF NOT private.consultor_usuario_pode_gerenciar_cedente(v_owner, v_alfa)
     OR NOT private.consultor_usuario_pode_gerenciar_cedente(v_operador, v_alfa)
     OR private.consultor_usuario_pode_gerenciar_cedente(v_leitor, v_alfa)
     OR private.consultor_usuario_pode_gerenciar_cedente(v_owner, v_gama) THEN
    RAISE EXCEPTION 'can_manage nao respeitou papel ou isolamento organizacional';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  IF NOT private.consultor_usuario_pode_operar_cedente(v_owner, v_alfa)
     OR private.consultor_usuario_pode_operar_cedente(v_operador, v_alfa)
     OR private.consultor_usuario_pode_operar_cedente(v_owner, v_beta)
     OR private.consultor_usuario_pode_operar_cedente(v_owner, v_gama) THEN
    RAISE EXCEPTION 'can_operate nao respeitou papel, Fundo ou isolamento organizacional';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_operador::text, true);
  IF NOT private.consultor_usuario_pode_operar_cedente(v_operador, v_alfa) THEN
    RAISE EXCEPTION 'OPERADOR ativo perdeu acesso operacional';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_leitor::text, true);
  IF private.consultor_usuario_pode_operar_cedente(v_leitor, v_alfa) THEN
    RAISE EXCEPTION 'LEITOR recebeu acesso operacional';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_inativo::text, true);
  IF private.consultor_usuario_pode_operar_cedente(v_inativo, v_alfa) THEN
    RAISE EXCEPTION 'usuario inativo recebeu acesso operacional';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_carlos::text, true);
  IF NOT private.consultor_usuario_pode_operar_cedente(v_carlos, v_gama) THEN
    RAISE EXCEPTION 'OWNER da organizacao ACME perdeu a propria carteira';
  END IF;

  INSERT INTO public.consultor_fundos (consultor_id, fundo_id, status)
  VALUES (v_xpto, v_health, 'ativo');
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  IF NOT private.consultor_usuario_pode_operar_cedente(v_owner, v_beta) THEN
    RAISE EXCEPTION 'adicao de Fundo nao restaurou acesso operacional';
  END IF;
  UPDATE public.consultor_fundos SET status = 'inativo' WHERE consultor_id = v_xpto AND fundo_id = v_rlx;
  IF private.consultor_usuario_pode_operar_cedente(v_owner, v_alfa) THEN
    RAISE EXCEPTION 'remocao de Fundo nao revogou acesso operacional';
  END IF;

  UPDATE public.consultores SET status = 'inativo' WHERE id = v_xpto;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  IF private.consultor_usuario_pode_gerenciar_cedente(v_owner, v_beta)
     OR private.consultor_usuario_pode_operar_cedente(v_owner, v_beta) THEN
    RAISE EXCEPTION 'organizacao inativa manteve acesso';
  END IF;
  UPDATE public.consultores SET status = 'ativo' WHERE id = v_xpto;
  PERFORM set_config('request.jwt.claim.sub', v_operador::text, true);
  IF NOT private.consultor_usuario_pode_operar_cedente(v_operador, v_beta) THEN
    RAISE EXCEPTION 'reativacao da organizacao nao restaurou vinculos intactos';
  END IF;
  UPDATE public.consultor_fundos
  SET status = 'ativo', revogado_por = null, revogado_em = null
  WHERE consultor_id = v_xpto AND fundo_id = v_rlx;
END;
$test$;

SET LOCAL ROLE authenticated;
SET LOCAL search_path = extensions, public;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

SELECT lives_ok(
  $$
    INSERT INTO public.eventos_dominio (
      tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
      tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
      ator_perfil_snapshot, origem, descricao, metadata, visibilidade
    ) VALUES (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      'qa_c1_1_owner_evento', 'operacao',
      '10000000-0000-4000-8000-000000000001',
      'Owner C1.1', 'consultor', 'qa_c1_1_rls',
      'Evento QA do OWNER', '{}'::jsonb, 'ambos'
    )
  $$,
  'OWNER ativo registra evento da carteira organizacional'
);

SELECT is(
  (SELECT count(*) FROM public.eventos_dominio WHERE tipo_evento = 'qa_c1_1_owner_evento'),
  1::bigint,
  'OWNER ativo le evento da propria carteira'
);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT lives_ok(
  $$
    INSERT INTO public.eventos_dominio (
      tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
      tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
      ator_perfil_snapshot, origem, descricao, metadata, visibilidade
    ) VALUES (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      'qa_c1_1_operador_evento', 'operacao',
      '10000000-0000-4000-8000-000000000002',
      'Operador C1.1', 'consultor', 'qa_c1_1_rls',
      'Evento QA do OPERADOR', '{}'::jsonb, 'ambos'
    )
  $$,
  'OPERADOR ativo registra evento da carteira organizacional'
);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
SELECT throws_ok(
  $$
    INSERT INTO public.eventos_dominio (
      tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
      tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
      ator_perfil_snapshot, origem, descricao, metadata, visibilidade
    ) VALUES (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      'qa_c1_1_leitor_evento', 'operacao',
      '10000000-0000-4000-8000-000000000003',
      'Leitor C1.1', 'consultor', 'qa_c1_1_rls',
      'Evento QA do LEITOR', '{}'::jsonb, 'ambos'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "eventos_dominio"',
  'LEITOR nao registra evento operacional'
);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
SELECT is(
  (SELECT count(*) FROM public.eventos_dominio WHERE tipo_evento = 'qa_c1_1_owner_evento'),
  0::bigint,
  'Consultor de outra organizacao nao le evento da XPTO'
);
SELECT throws_ok(
  $$
    INSERT INTO public.eventos_dominio (
      tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
      tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
      ator_perfil_snapshot, origem, descricao, metadata, visibilidade
    ) VALUES (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      'qa_c1_1_cross_org_evento', 'operacao',
      '10000000-0000-4000-8000-000000000005',
      'Carlos C1.1', 'consultor', 'qa_c1_1_rls',
      'Evento QA cross-org', '{}'::jsonb, 'ambos'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "eventos_dominio"',
  'Consultor de outra organizacao nao registra evento da XPTO'
);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT throws_ok(
  $$
    INSERT INTO public.eventos_dominio (
      tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
      tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
      ator_perfil_snapshot, origem, descricao, metadata, visibilidade
    ) VALUES (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      'qa_c1_1_actor_spoof', 'operacao',
      '10000000-0000-4000-8000-000000000001',
      'Owner C1.1', 'consultor', 'qa_c1_1_rls',
      'Tentativa de adulterar ator', '{}'::jsonb, 'ambos'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "eventos_dominio"',
  'OPERADOR nao pode registrar evento em nome do OWNER'
);

RESET ROLE;

SELECT pass('C1.1 organization membership, roles, cross-org and Fund revocation');
SELECT * FROM finish();

ROLLBACK;
