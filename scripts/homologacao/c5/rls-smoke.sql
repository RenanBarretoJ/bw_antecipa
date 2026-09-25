\set ON_ERROR_STOP on

BEGIN;

SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('c5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner-c5@local.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c5000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'admin-c5@local.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c5000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'operador-c5@local.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c5000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'leitor-c5@local.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c5000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'inativo-c5@local.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c5000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'outro-c5@local.test', '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.profiles (id, role, nome_completo, email, status)
VALUES
  ('c5000000-0000-4000-8000-000000000001', 'consultor', 'Owner C5', 'owner-c5@local.test', 'ativo'),
  ('c5000000-0000-4000-8000-000000000002', 'consultor', 'Admin C5', 'admin-c5@local.test', 'ativo'),
  ('c5000000-0000-4000-8000-000000000003', 'consultor', 'Operador C5', 'operador-c5@local.test', 'ativo'),
  ('c5000000-0000-4000-8000-000000000004', 'consultor', 'Leitor C5', 'leitor-c5@local.test', 'ativo'),
  ('c5000000-0000-4000-8000-000000000005', 'consultor', 'Inativo C5', 'inativo-c5@local.test', 'ativo'),
  ('c5000000-0000-4000-8000-000000000006', 'consultor', 'Outro C5', 'outro-c5@local.test', 'ativo');

INSERT INTO public.fundos (
  id, nome, cnpj, administradora_nome, administradora_cnpj,
  gestora_nome, gestora_cnpj, ativo
)
VALUES
  ('c5100000-0000-4000-8000-000000000001', 'Fundo A C5', '98000000000196', 'Admin A', '98000000000277', 'Gestora A', '98000000000358', true),
  ('c5100000-0000-4000-8000-000000000002', 'Fundo B C5', '98000000000439', 'Admin B', '98000000000510', 'Gestora B', '98000000000609', true);

INSERT INTO public.cedentes (id, cnpj, razao_social, status, fundo_id)
VALUES
  ('c5200000-0000-4000-8000-000000000001', '98100000000168', 'Cedente A C5', 'ativo', 'c5100000-0000-4000-8000-000000000001'),
  ('c5200000-0000-4000-8000-000000000002', '98100000000249', 'Cedente B C5', 'ativo', 'c5100000-0000-4000-8000-000000000002');

INSERT INTO public.cedente_fundos (id, cedente_id, fundo_id, status)
VALUES
  ('c5300000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001', 'ativo'),
  ('c5300000-0000-4000-8000-000000000002', 'c5200000-0000-4000-8000-000000000002', 'c5100000-0000-4000-8000-000000000002', 'ativo');

INSERT INTO public.consultores (id, cnpj, razao_social, status)
VALUES
  ('c5600000-0000-4000-8000-000000000001', '98200000000130', 'Consultoria A C5', 'ativo'),
  ('c5600000-0000-4000-8000-000000000002', '98200000000210', 'Consultoria B C5', 'ativo');

INSERT INTO public.consultor_usuarios (consultor_id, user_id, papel, status, ativado_em, desativado_em)
VALUES
  ('c5600000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'OWNER', 'ativo', now(), null),
  ('c5600000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000002', 'ADMIN', 'ativo', now(), null),
  ('c5600000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000003', 'OPERADOR', 'ativo', now(), null),
  ('c5600000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000004', 'LEITOR', 'ativo', now(), null),
  ('c5600000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000005', 'OPERADOR', 'inativo', now(), now()),
  ('c5600000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000006', 'OWNER', 'ativo', now(), null);

INSERT INTO public.consultor_fundos (consultor_id, fundo_id, status)
VALUES
  ('c5600000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001', 'ativo'),
  ('c5600000-0000-4000-8000-000000000002', 'c5100000-0000-4000-8000-000000000002', 'ativo');

INSERT INTO public.consultor_cedentes (consultor_id, cedente_id, status)
VALUES
  ('c5600000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000001', 'ativo'),
  ('c5600000-0000-4000-8000-000000000002', 'c5200000-0000-4000-8000-000000000002', 'ativo');

INSERT INTO public.operacoes (
  id, cedente_id, valor_bruto_total, prazo_dias, data_vencimento, status, cedente_fundo_id
)
VALUES
  ('c5400000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000001', 1000, 30, current_date + 30, 'solicitada', 'c5300000-0000-4000-8000-000000000001'),
  ('c5400000-0000-4000-8000-000000000002', 'c5200000-0000-4000-8000-000000000002', 2000, 30, current_date + 30, 'solicitada', 'c5300000-0000-4000-8000-000000000002');

INSERT INTO public.eventos_dominio (
  id, fundo_id, cedente_id, cedente_fundo_id, operacao_id,
  tipo_evento, categoria, descricao, visibilidade
)
VALUES
  ('c5500000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000001', 'c5300000-0000-4000-8000-000000000001', 'c5400000-0000-4000-8000-000000000001', 'c5_publico_a', 'operacao', 'Evento publico A', 'ambos'),
  ('c5500000-0000-4000-8000-000000000002', 'c5100000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000001', 'c5300000-0000-4000-8000-000000000001', 'c5400000-0000-4000-8000-000000000001', 'c5_interno_a', 'operacao', 'Evento interno A', 'interno'),
  ('c5500000-0000-4000-8000-000000000003', 'c5100000-0000-4000-8000-000000000002', 'c5200000-0000-4000-8000-000000000002', 'c5300000-0000-4000-8000-000000000002', 'c5400000-0000-4000-8000-000000000002', 'c5_publico_b', 'operacao', 'Evento publico B', 'ambos');

SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $roles$
DECLARE
  v_user uuid;
  v_expected uuid := 'c5400000-0000-4000-8000-000000000001';
  v_seen uuid[];
BEGIN
  FOREACH v_user IN ARRAY ARRAY[
    'c5000000-0000-4000-8000-000000000001'::uuid,
    'c5000000-0000-4000-8000-000000000002'::uuid,
    'c5000000-0000-4000-8000-000000000003'::uuid,
    'c5000000-0000-4000-8000-000000000004'::uuid
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    SELECT coalesce(array_agg(id ORDER BY id), array[]::uuid[]) INTO v_seen
    FROM public.operacoes;
    IF v_seen <> ARRAY[v_expected] THEN
      RAISE EXCEPTION 'C5-R2: papel ativo % recebeu escopo incorreto: %', v_user, v_seen;
    END IF;
  END LOOP;
END;
$roles$;

SELECT set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000004', true);
DO $leitor$
DECLARE
  v_eventos text[];
  v_fundos uuid[];
  v_mutacoes integer := 0;
BEGIN
  SELECT coalesce(array_agg(tipo_evento ORDER BY tipo_evento), array[]::text[])
    INTO v_eventos
    FROM public.eventos_dominio;
  IF v_eventos <> ARRAY['c5_publico_a'::text] THEN
    RAISE EXCEPTION 'C5-R2: LEITOR recebeu timeline incorreta: %', v_eventos;
  END IF;

  SELECT coalesce(array_agg(id ORDER BY id), array[]::uuid[])
    INTO v_fundos
    FROM public.listar_fundos_visiveis_consultor();
  IF v_fundos <> ARRAY['c5100000-0000-4000-8000-000000000001'::uuid] THEN
    RAISE EXCEPTION 'C5-R2: LEITOR recebeu Fundos incorretos: %', v_fundos;
  END IF;

  IF NOT public.consultor_pode_visualizar_operacao('c5400000-0000-4000-8000-000000000001')
     OR public.consultor_pode_visualizar_operacao('c5400000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'C5-R2: gate explicito do LEITOR incorreto';
  END IF;

  BEGIN
    WITH alteradas AS (
      UPDATE public.operacoes
      SET prazo_dias = prazo_dias + 1
      WHERE id = 'c5400000-0000-4000-8000-000000000001'
      RETURNING 1
    )
    SELECT count(*) INTO v_mutacoes FROM alteradas;
  EXCEPTION WHEN insufficient_privilege THEN
    v_mutacoes := 0;
  END;
  IF v_mutacoes <> 0 THEN
    RAISE EXCEPTION 'C5-R2: LEITOR conseguiu alterar operacao';
  END IF;
END;
$leitor$;

SELECT set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000005', true);
DO $membership_inativo$
BEGIN
  IF EXISTS (SELECT 1 FROM public.operacoes) THEN
    RAISE EXCEPTION 'C5-R2: membership inativo manteve leitura';
  END IF;
END;
$membership_inativo$;

SELECT set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000006', true);
DO $cross_org$
DECLARE
  v_seen uuid[];
BEGIN
  SELECT coalesce(array_agg(id ORDER BY id), array[]::uuid[]) INTO v_seen
  FROM public.operacoes;
  IF v_seen <> ARRAY['c5400000-0000-4000-8000-000000000002'::uuid] THEN
    RAISE EXCEPTION 'C5-R2: isolamento entre organizacoes falhou: %', v_seen;
  END IF;
END;
$cross_org$;

RESET ROLE;
UPDATE public.consultores SET status = 'inativo'
WHERE id = 'c5600000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000001', true);
DO $org_inativa$
BEGIN
  IF EXISTS (SELECT 1 FROM public.operacoes) THEN
    RAISE EXCEPTION 'C5-R2: organizacao inativa manteve leitura';
  END IF;
END;
$org_inativa$;

RESET ROLE;
UPDATE public.consultores SET status = 'ativo'
WHERE id = 'c5600000-0000-4000-8000-000000000001';
UPDATE public.consultor_fundos SET status = 'inativo'
WHERE consultor_id = 'c5600000-0000-4000-8000-000000000001'
  AND fundo_id = 'c5100000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000001', true);
DO $fundo_revogado$
BEGIN
  IF EXISTS (SELECT 1 FROM public.operacoes) THEN
    RAISE EXCEPTION 'C5-R2: Fundo revogado manteve leitura';
  END IF;
END;
$fundo_revogado$;

RESET ROLE;
ROLLBACK;

\echo 'C5_R2_RLS_SMOKE_OK'
