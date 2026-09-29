\set ON_ERROR_STOP on

BEGIN;

SELECT plan(28);

DO $setup$
DECLARE
  v_consultor_user uuid := '21000000-0000-4000-8000-000000000001';
  v_leitor_user uuid := '21000000-0000-4000-8000-000000000002';
  v_cedente_user uuid := '21000000-0000-4000-8000-000000000003';
  v_gestor_user uuid := '21000000-0000-4000-8000-000000000004';
BEGIN
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_consultor_user, 'operador-c21@example.invalid', '{}'::jsonb, '{"nome_completo":"Operador C2.1"}'::jsonb, now(), now()),
    (v_leitor_user, 'leitor-c21@example.invalid', '{}'::jsonb, '{"nome_completo":"Leitor C2.1"}'::jsonb, now(), now()),
    (v_cedente_user, 'cedente-c21@example.invalid', '{}'::jsonb, '{"nome_completo":"Cedente C2.1"}'::jsonb, now(), now()),
    (v_gestor_user, 'gestor-c21@example.invalid', '{}'::jsonb, '{"nome_completo":"Gestor C2.1"}'::jsonb, now(), now());

  INSERT INTO public.profiles (id, role, nome_completo, email, status)
  VALUES
    (v_consultor_user, 'consultor', 'Operador C2.1', 'operador-c21@example.invalid', 'ativo'),
    (v_leitor_user, 'consultor', 'Leitor C2.1', 'leitor-c21@example.invalid', 'ativo'),
    (v_cedente_user, 'cedente', 'Cedente C2.1', 'cedente-c21@example.invalid', 'ativo'),
    (v_gestor_user, 'gestor', 'Gestor C2.1', 'gestor-c21@example.invalid', 'ativo')
  ON CONFLICT (id) DO UPDATE
  SET role = excluded.role,
      nome_completo = excluded.nome_completo,
      email = excluded.email,
      status = excluded.status;

  INSERT INTO public.fundos (
    id, nome, cnpj, administradora_nome, administradora_cnpj,
    gestora_nome, gestora_cnpj, ativo
  ) VALUES (
    '22000000-0000-4000-8000-000000000001',
    'Fundo QA C2.1',
    '98000000000196',
    'Administradora QA',
    '98000000000277',
    'Gestora QA',
    '98000000000358',
    true
  );

  INSERT INTO public.usuario_fundos (usuario_id, fundo_id, status)
  VALUES (v_gestor_user, '22000000-0000-4000-8000-000000000001', 'ativo');

  INSERT INTO public.cedentes (id, user_id, cnpj, razao_social, status, fundo_id)
  VALUES (
    '23000000-0000-4000-8000-000000000001',
    v_cedente_user,
    '98100000000168',
    'Cedente QA C2.1',
    'ativo',
    '22000000-0000-4000-8000-000000000001'
  );

  INSERT INTO public.cedente_fundos (id, cedente_id, fundo_id, status)
  VALUES (
    '24000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'ativo'
  );

  INSERT INTO public.contas_escrow (id, cedente_id, identificador, status)
  VALUES (
    '25000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'ESCROW-C21',
    'ativa'
  );

  INSERT INTO public.politicas_operacionais (
    id, codigo, nome, status, created_by, fundo_id, padrao
  ) VALUES (
    '26000000-0000-4000-8000-000000000001',
    'QA_C2_1',
    'Politica QA C2.1',
    'ativa',
    v_gestor_user,
    '22000000-0000-4000-8000-000000000001',
    true
  );

  INSERT INTO public.politica_operacional_versoes (
    id, politica_operacional_id, versao, vigente_desde,
    aceite_sacado_obrigatorio, cessao_no_desembolso,
    cria_acompanhamento_entrega, configuracao, conteudo_hash,
    publicada_por, publicada_em, fundo_id, status,
    metodo_calculo_financeiro
  ) VALUES (
    '27000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    1,
    now() - interval '1 day',
    false,
    true,
    false,
    '{"calculo_financeiro":{"metodo":"TRINTA_360","versao_motor":1}}'::jsonb,
    repeat('a', 64),
    v_gestor_user,
    now() - interval '1 day',
    '22000000-0000-4000-8000-000000000001',
    'publicada',
    'TRINTA_360'
  );

  INSERT INTO public.cedente_fundo_politicas (
    id, cedente_fundo_id, politica_operacional_id, status, vigente_desde, atribuido_por
  ) VALUES (
    '28000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    'ativa',
    now() - interval '1 day',
    v_gestor_user
  );

  INSERT INTO public.taxas_cedente (cedente_id, prazo_min, prazo_max, taxa_percentual)
  VALUES
    ('23000000-0000-4000-8000-000000000001', 0, 180, 2.50),
    ('23000000-0000-4000-8000-000000000001', 0, 180, 2.35);

  INSERT INTO public.consultores (id, cnpj, razao_social, status, created_by)
  VALUES (
    '29000000-0000-4000-8000-000000000001',
    '98200010000175',
    'Consultoria QA C2.1',
    'ativo',
    v_gestor_user
  );

  INSERT INTO public.consultor_usuarios (
    consultor_id, user_id, papel, status, ativado_em
  ) VALUES
    ('29000000-0000-4000-8000-000000000001', v_consultor_user, 'OPERADOR', 'ativo', now()),
    ('29000000-0000-4000-8000-000000000001', v_leitor_user, 'LEITOR', 'ativo', now());

  INSERT INTO public.consultor_fundos (consultor_id, fundo_id, status, concedido_por)
  VALUES (
    '29000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'ativo',
    v_gestor_user
  );

  INSERT INTO public.consultor_cedentes (
    consultor_id, cedente_id, status, vinculado_por
  ) VALUES (
    '29000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    'ativo',
    v_gestor_user
  );

  INSERT INTO public.notas_fiscais (
    id, cedente_id, cedente_fundo_id, fundo_id,
    numero_nf, serie, data_emissao, data_vencimento,
    cnpj_emitente, razao_social_emitente,
    cnpj_destinatario, razao_social_destinatario,
    valor_bruto, valor_liquido, status
  ) VALUES
    (
      '2a000000-0000-4000-8000-000000000001',
      '23000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      'C21-CONSULTOR', '1', current_date, current_date + 30,
      '98100000000168', 'Cedente QA C2.1',
      '11222333000181', 'Sacado QA C2.1',
      1000, 1000, 'aprovada'
    ),
    (
      '2a000000-0000-4000-8000-000000000002',
      '23000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      'C21-CEDENTE', '1', current_date, current_date + 30,
      '98100000000168', 'Cedente QA C2.1',
      '11222333000181', 'Sacado QA C2.1',
      500, 500, 'aprovada'
    ),
    (
      '2a000000-0000-4000-8000-000000000003',
      '23000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      'C21-CONSULTOR-ALTERA', '1', current_date, current_date + 30,
      '98100000000168', 'Cedente QA C2.1',
      '11222333000181', 'Sacado QA C2.1',
      750, 750, 'aprovada'
    ),
    (
      '2a000000-0000-4000-8000-000000000004',
      '23000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      'C21-CONSULTOR-LIVRE', '1', current_date, current_date + 30,
      '98100000000168', 'Cedente QA C2.1',
      '11222333000181', 'Sacado QA C2.1',
      900, 900, 'aprovada'
    );
END;
$setup$;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-000000000001', true);

SELECT lives_ok(
  $$SELECT public.solicitar_operacao_antecipacao_consultor_atomica(
    '23000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    '27000000-0000-4000-8000-000000000001',
    1,
    '{"calculo_financeiro":{"metodo":"TRINTA_360","versao_motor":1}}'::jsonb,
    repeat('a', 64),
    false,
    'dispensado',
    ARRAY['2a000000-0000-4000-8000-000000000001']::uuid[],
    2.50,
    repeat('b', 64),
    NULL
  )$$,
  'OPERADOR cria operacao com proposta valida'
);

SELECT is(
  (SELECT taxa_proposta_consultor::text FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('b', 64)),
  '2.50',
  'taxa proposta permanece persistida'
);
SELECT is(
  (SELECT taxa_desconto::text FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('b', 64)),
  '2.50',
  'taxa corrente nasce igual a proposta'
);
SELECT ok(
  (SELECT calculo_proposta_memoria ? 'itens' FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('b', 64)),
  'snapshot da proposta contem memoria por item'
);
SELECT is(
  (SELECT count(*)::integer FROM public.logs_auditoria WHERE tipo_evento = 'TAXA_PROPOSTA_CONSULTOR'),
  1,
  'proposta gera um unico audit tecnico'
);

SELECT lives_ok(
  $$SELECT public.solicitar_operacao_antecipacao_consultor_atomica(
    '23000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    '27000000-0000-4000-8000-000000000001',
    1,
    '{"calculo_financeiro":{"metodo":"TRINTA_360","versao_motor":1}}'::jsonb,
    repeat('a', 64), false, 'dispensado',
    ARRAY['2a000000-0000-4000-8000-000000000001']::uuid[],
    2.50, repeat('b', 64), NULL
  )$$,
  'retry identico e idempotente'
);
SELECT is(
  (SELECT count(*)::integer FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('b', 64)),
  1,
  'retry nao duplica operacao'
);

SELECT lives_ok(
  $$SELECT public.solicitar_operacao_antecipacao_consultor_atomica(
    '23000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    '27000000-0000-4000-8000-000000000001',
    1,
    '{"calculo_financeiro":{"metodo":"TRINTA_360","versao_motor":1}}'::jsonb,
    repeat('a', 64), false, 'dispensado',
    ARRAY['2a000000-0000-4000-8000-000000000003']::uuid[],
    2.50, repeat('f', 64), NULL
  )$$,
  'OPERADOR cria segunda operacao para alteracao da taxa pelo Gestor'
);

SELECT lives_ok(
  $$SELECT public.solicitar_operacao_antecipacao_consultor_atomica(
    '23000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    '27000000-0000-4000-8000-000000000001',
    1,
    '{"calculo_financeiro":{"metodo":"TRINTA_360","versao_motor":1}}'::jsonb,
    repeat('a', 64), false, 'dispensado',
    ARRAY['2a000000-0000-4000-8000-000000000004']::uuid[],
    2.40, repeat('c', 64), NULL
  )$$,
  'OPERADOR pode propor taxa livre nao cadastrada pelo Gestor'
);

SELECT set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-000000000002', true);
SELECT throws_ok(
  $$SELECT public.solicitar_operacao_antecipacao_consultor_atomica(
    '23000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    '27000000-0000-4000-8000-000000000001',
    1, '{}'::jsonb, repeat('a', 64), false, 'dispensado',
    ARRAY['2a000000-0000-4000-8000-000000000001']::uuid[],
    2.50, repeat('d', 64), NULL
  )$$,
  'Consultor sem vinculo organizacional ativo com o Cedente informado',
  'LEITOR nao pode propor taxa'
);

SELECT set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-000000000003', true);
SELECT lives_ok(
  $$SELECT public.solicitar_operacao_antecipacao_cedente_atomica(
    '23000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    '27000000-0000-4000-8000-000000000001',
    1,
    '{"calculo_financeiro":{"metodo":"TRINTA_360","versao_motor":1}}'::jsonb,
    repeat('a', 64), false, 'dispensado',
    ARRAY['2a000000-0000-4000-8000-000000000002']::uuid[],
    500, 2.50, 30, 487.80, current_date + 30,
    repeat('e', 64), NULL
  )$$,
  'fluxo direto do Cedente continua funcional'
);
SELECT ok(
  (SELECT taxa_proposta_consultor IS NULL AND calculo_proposta_memoria IS NULL
   FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('e', 64)),
  'operacao direta do Cedente nao recebe proposta de Consultor'
);

SELECT throws_ok(
  $$UPDATE public.operacoes
    SET taxa_proposta_consultor = 2.35
    WHERE solicitacao_idempotency_key = repeat('b', 64)$$,
  'A proposta de taxa do Consultor e imutavel',
  'proposta original nao pode ser sobrescrita'
);

SELECT set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT set_config('app.c2_1_gravar_proposta', 'true', true);
SELECT throws_ok(
  $$UPDATE public.operacoes
    SET taxa_proposta_consultor = 2.50,
        taxa_proposta_por = '21000000-0000-4000-8000-000000000003',
        taxa_proposta_consultor_id = '29000000-0000-4000-8000-000000000001',
        taxa_proposta_em = now(),
        calculo_proposta_memoria = '{}'::jsonb
    WHERE solicitacao_idempotency_key = repeat('e', 64)$$,
  'A proposta de taxa do Consultor e imutavel',
  'Cedente nao burla a imutabilidade forjando a configuracao de sessao'
);
RESET ROLE;
SELECT set_config('app.c2_1_gravar_proposta', 'false', true);

INSERT INTO public.risco_execucoes (
  id, fundo_id, operacao_id, escopo, origem,
  politica_operacional_versao_id, data_operacional, overlay_as_of,
  operacao_updated_at_snapshot, taxa_desconto_snapshot,
  aplicavel, status_tecnico, decisao, assinatura_inputs, criado_por
)
SELECT
  CASE o.solicitacao_idempotency_key
    WHEN repeat('b', 64) THEN '2b000000-0000-4000-8000-000000000001'::uuid
    WHEN repeat('f', 64) THEN '2b000000-0000-4000-8000-000000000002'::uuid
    ELSE '2b000000-0000-4000-8000-000000000003'::uuid
  END,
  '22000000-0000-4000-8000-000000000001'::uuid,
  o.id,
  'OPERACAO',
  'APROVACAO_OPERACAO',
  o.politica_operacional_versao_id,
  current_date,
  now(),
  o.updated_at,
  CASE o.solicitacao_idempotency_key
    WHEN repeat('b', 64) THEN 2.50
    WHEN repeat('f', 64) THEN 2.35
    ELSE 2.40
  END,
  false,
  'NAO_APLICAVEL',
  NULL,
  CASE o.solicitacao_idempotency_key
    WHEN repeat('b', 64) THEN repeat('1', 64)
    WHEN repeat('f', 64) THEN repeat('2', 64)
    ELSE repeat('3', 64)
  END,
  '21000000-0000-4000-8000-000000000004'::uuid
FROM public.operacoes o
WHERE o.solicitacao_idempotency_key IN (repeat('b', 64), repeat('f', 64), repeat('c', 64));

SELECT set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-000000000004', true);

SELECT lives_ok(
  $$SELECT public.aprovar_operacao_com_risco_atomica(
    (SELECT id FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('b', 64)),
    2.50,
    '2b000000-0000-4000-8000-000000000001',
    repeat('1', 64)
  )$$,
  'Gestor aprova mantendo a taxa proposta'
);
SELECT is(
  (SELECT taxa_proposta_consultor::text FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('b', 64)),
  '2.50',
  'proposta 2.50 permanece apos aprovacao sem alteracao'
);
SELECT is(
  (SELECT taxa_desconto::text FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('b', 64)),
  '2.50',
  'taxa final 2.50 e persistida'
);
SELECT is(
  (SELECT calculo_memoria->>'taxa_mensal' FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('b', 64)),
  '2.50',
  'snapshot final usa taxa mantida'
);
SELECT is(
  (SELECT count(*)::integer FROM public.logs_auditoria
   WHERE tipo_evento = 'TAXA_MANTIDA_GESTOR'
     AND entidade_id = (SELECT id FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('b', 64))),
  1,
  'taxa mantida gera audit atomico do Gestor'
);

SELECT lives_ok(
  $$SELECT public.aprovar_operacao_com_risco_atomica(
    (SELECT id FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('c', 64)),
    2.40,
    '2b000000-0000-4000-8000-000000000003',
    repeat('3', 64)
  )$$,
  'Gestor aprova mantendo taxa livre proposta pelo Consultor'
);
SELECT is(
  (SELECT taxa_desconto::text FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('c', 64)),
  '2.40',
  'taxa livre mantida e persistida como taxa final'
);

SELECT lives_ok(
  $$SELECT public.aprovar_operacao_com_risco_atomica(
    (SELECT id FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('f', 64)),
    2.35,
    '2b000000-0000-4000-8000-000000000002',
    repeat('2', 64)
  )$$,
  'Gestor aprova alterando a taxa final'
);
SELECT is(
  (SELECT taxa_proposta_consultor::text FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('f', 64)),
  '2.50',
  'proposta 2.50 permanece apos alteracao do Gestor'
);
SELECT is(
  (SELECT taxa_desconto::text FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('f', 64)),
  '2.35',
  'taxa final alterada para 2.35 e persistida'
);
SELECT is(
  (SELECT calculo_memoria->>'taxa_mensal' FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('f', 64)),
  '2.35',
  'snapshot final e recalculado com taxa 2.35'
);
SELECT is(
  (SELECT count(*)::integer FROM public.logs_auditoria
   WHERE tipo_evento = 'TAXA_ALTERADA_GESTOR'
     AND entidade_id = (SELECT id FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('f', 64))),
  1,
  'taxa alterada gera audit atomico do Gestor'
);
SELECT throws_ok(
  $$SELECT public.aprovar_operacao_com_risco_atomica(
    (SELECT id FROM public.operacoes WHERE solicitacao_idempotency_key = repeat('f', 64)),
    2.50,
    '2b000000-0000-4000-8000-000000000002',
    repeat('2', 64)
  )$$,
  'Operacao nao elegivel ou alterada concorrentemente',
  'segunda aprovacao perde por conflito e nao troca a taxa final'
);
SELECT is(
  (SELECT count(*)::integer FROM public.logs_auditoria
   WHERE tipo_evento IN ('TAXA_MANTIDA_GESTOR', 'TAXA_ALTERADA_GESTOR')),
  3,
  'ha uma unica decisao final auditada por operacao'
);

SELECT * FROM finish();

ROLLBACK;
