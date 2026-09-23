\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_user_id uuid := pg_catalog.gen_random_uuid();
  v_invalid_user_id uuid := pg_catalog.gen_random_uuid();
  v_profile_count bigint;
  v_role text;
  v_nome text;
  v_invalid_failed boolean := false;
BEGIN
  INSERT INTO auth.users (
    id,
    email,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES (
    v_user_id,
    'qa-p2-auth-profile@example.invalid',
    '{}'::jsonb,
    jsonb_build_object(
      'nome_completo', 'QA P2 Auth Profile',
      'role', 'super_admin'
    ),
    now(),
    now()
  );

  SELECT pg_catalog.count(*), pg_catalog.min(p.role::text), pg_catalog.min(p.nome_completo)
    INTO v_profile_count, v_role, v_nome
    FROM public.profiles p
   WHERE p.id = v_user_id;

  IF v_profile_count <> 1
     OR v_role <> 'cedente'
     OR v_nome <> 'QA P2 Auth Profile' THEN
    RAISE EXCEPTION 'fluxo Auth/profile produziu perfil inesperado';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM public.usuario_papeis up
     WHERE up.usuario_id = v_user_id
       AND up.papel::text = 'cedente'
       AND up.ativo = true
  ) <> 1 THEN
    RAISE EXCEPTION 'fluxo Auth/profile nao sincronizou o papel primario';
  END IF;

  BEGIN
    INSERT INTO auth.users (
      id,
      email,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    VALUES (
      v_invalid_user_id,
      NULL,
      '{}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );
  EXCEPTION WHEN not_null_violation THEN
    v_invalid_failed := true;
  END;

  IF NOT v_invalid_failed
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_invalid_user_id) THEN
    RAISE EXCEPTION 'fluxo Auth/profile aceitou usuario sintetico invalido';
  END IF;

  DELETE FROM auth.users WHERE id = v_user_id;

  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user_id)
     OR EXISTS (SELECT 1 FROM public.usuario_papeis up WHERE up.usuario_id = v_user_id) THEN
    RAISE EXCEPTION 'cleanup do usuario sintetico deixou registros derivados';
  END IF;
END;
$test$;

SELECT 'P2_AUTH_FLOW_REGRESSION=PASS' AS resultado;

ROLLBACK;
