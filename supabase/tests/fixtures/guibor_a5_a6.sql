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
    valor_bruto, valor_liquido, valor_liquido_origem, status
  ) VALUES
    (
      '2a000000-0000-4000-8000-000000000001',
      '23000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      'C21-CONSULTOR', '1', current_date, current_date + 30,
      '98100000000168', 'Cedente QA C2.1',
      '11222333000181', 'Sacado QA C2.1',
      100000, 90000, 'DOCUMENTO_EXPLICITO', 'aprovada'
    ),
    (
      '2a000000-0000-4000-8000-000000000002',
      '23000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      'C21-CEDENTE', '1', current_date, current_date + 30,
      '98100000000168', 'Cedente QA C2.1',
      '11222333000181', 'Sacado QA C2.1',
      39521.98, 37229.70, 'DOCUMENTO_EXPLICITO', 'aprovada'
    ),
    (
      '2a000000-0000-4000-8000-000000000003',
      '23000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      'C21-CONSULTOR-ALTERA', '1', current_date, current_date + 30,
      '98100000000168', 'Cedente QA C2.1',
      '11222333000181', 'Sacado QA C2.1',
      112710.81, 105779.10, 'DOCUMENTO_EXPLICITO', 'aprovada'
    ),
    (
      '2a000000-0000-4000-8000-000000000004',
      '23000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      'C21-CONSULTOR-LIVRE', '1', current_date, current_date + 30,
      '98100000000168', 'Cedente QA C2.1',
      '11222333000181', 'Sacado QA C2.1',
      900, 900, 'LEGACY_BRUTO', 'aprovada'
    );
END;
$setup$;
