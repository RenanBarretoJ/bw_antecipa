\set ON_ERROR_STOP on

BEGIN;

SELECT plan(1);

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
BEGIN
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_owner, 'owner-c11@example.invalid', '{}'::jsonb, '{"nome_completo":"Owner C11"}'::jsonb, now(), now()),
    (v_operador, 'operador-c11@example.invalid', '{}'::jsonb, '{"nome_completo":"Operador C11"}'::jsonb, now(), now()),
    (v_leitor, 'leitor-c11@example.invalid', '{}'::jsonb, '{"nome_completo":"Leitor C11"}'::jsonb, now(), now()),
    (v_inativo, 'inativo-c11@example.invalid', '{}'::jsonb, '{"nome_completo":"Inativo C11"}'::jsonb, now(), now()),
    (v_carlos, 'carlos-c11@example.invalid', '{}'::jsonb, '{"nome_completo":"Carlos C11"}'::jsonb, now(), now());

  UPDATE public.profiles SET role = 'consultor'::public.user_role, status = 'ativo'::public.user_status
  WHERE id IN (v_owner, v_operador, v_leitor, v_inativo, v_carlos);

  INSERT INTO public.fundos (
    id, nome, cnpj, administradora_nome, administradora_cnpj,
    gestora_nome, gestora_cnpj, ativo
  ) VALUES
    (v_rlx, 'RLX C1.1', '11344038002141', 'Admin RLX', '07312248000137', 'Gestora RLX', '96764550000156', true),
    (v_health, 'HEALTH C1.1', '20817796000187', 'Admin HEALTH', '96764550000156', 'Gestora HEALTH', '07312248000137', true);

  INSERT INTO public.cedentes (id, cnpj, razao_social, status, fundo_id)
  VALUES
    (v_alfa, '96764550000156', 'Cedente Alfa C1.1', 'ativo'::public.cedente_status, v_rlx),
    (v_beta, '07312248000137', 'Cedente Beta C1.1', 'ativo'::public.cedente_status, v_health),
    (v_gama, '11344038002141', 'Cedente Gama C1.1', 'ativo'::public.cedente_status, v_health);

  INSERT INTO public.cedente_fundos (cedente_id, fundo_id, status)
  VALUES (v_alfa, v_rlx, 'ativo'), (v_beta, v_health, 'ativo'), (v_gama, v_health, 'ativo');

  INSERT INTO public.consultores (id, cnpj, razao_social, status)
  VALUES
    (v_xpto, '20817796000187', 'XPTO Consultoria C1.1', 'ativo'),
    (v_acme, '11344038002141', 'ACME Consultoria C1.1', 'ativo');

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
  IF NOT private.consultor_usuario_pode_operar_cedente(v_owner, v_alfa)
     OR NOT private.consultor_usuario_pode_operar_cedente(v_operador, v_alfa)
     OR private.consultor_usuario_pode_operar_cedente(v_leitor, v_alfa)
     OR private.consultor_usuario_pode_operar_cedente(v_inativo, v_alfa)
     OR private.consultor_usuario_pode_operar_cedente(v_owner, v_beta)
     OR private.consultor_usuario_pode_operar_cedente(v_owner, v_gama)
     OR NOT private.consultor_usuario_pode_operar_cedente(v_carlos, v_gama) THEN
    RAISE EXCEPTION 'can_operate nao respeitou papel, Fundo ou isolamento organizacional';
  END IF;

  INSERT INTO public.consultor_fundos (consultor_id, fundo_id, status)
  VALUES (v_xpto, v_health, 'ativo');
  IF NOT private.consultor_usuario_pode_operar_cedente(v_owner, v_beta) THEN
    RAISE EXCEPTION 'adicao de Fundo nao restaurou acesso operacional';
  END IF;
  UPDATE public.consultor_fundos SET status = 'inativo' WHERE consultor_id = v_xpto AND fundo_id = v_rlx;
  IF private.consultor_usuario_pode_operar_cedente(v_owner, v_alfa) THEN
    RAISE EXCEPTION 'remocao de Fundo nao revogou acesso operacional';
  END IF;

  UPDATE public.consultores SET status = 'inativo' WHERE id = v_xpto;
  IF private.consultor_usuario_pode_gerenciar_cedente(v_owner, v_beta)
     OR private.consultor_usuario_pode_operar_cedente(v_operador, v_beta) THEN
    RAISE EXCEPTION 'organizacao inativa manteve acesso';
  END IF;
  UPDATE public.consultores SET status = 'ativo' WHERE id = v_xpto;
  IF NOT private.consultor_usuario_pode_operar_cedente(v_operador, v_beta) THEN
    RAISE EXCEPTION 'reativacao da organizacao nao restaurou vinculos intactos';
  END IF;
END;
$test$;

SELECT pass('C1.1 organization membership, roles, cross-org and Fund revocation');
SELECT * FROM finish();

ROLLBACK;
