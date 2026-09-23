\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p2_assert_auth_trigger()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_relation_oid oid := pg_catalog.to_regclass('auth.users');
  v_function_oid oid := pg_catalog.to_regprocedure('public.handle_new_user()');
  v_trigger_count bigint;
  v_trigger_enabled "char";
  v_trigger_type smallint;
  v_trigger_function_oid oid;
  v_function_security_definer boolean;
  v_function_config text[];
BEGIN
  IF v_relation_oid IS NULL OR v_function_oid IS NULL THEN
    RAISE EXCEPTION 'relacao ou funcao obrigatoria ausente';
  END IF;

  SELECT pg_catalog.count(*)
    INTO v_trigger_count
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = v_relation_oid
     AND t.tgname = 'on_auth_user_created'
     AND NOT t.tgisinternal;

  IF v_trigger_count <> 1 THEN
    RAISE EXCEPTION 'esperado exatamente 1 trigger; encontrados %', v_trigger_count;
  END IF;

  SELECT t.tgenabled, t.tgtype, t.tgfoid
    INTO v_trigger_enabled, v_trigger_type, v_trigger_function_oid
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = v_relation_oid
     AND t.tgname = 'on_auth_user_created'
     AND NOT t.tgisinternal;

  IF v_trigger_enabled <> 'O'
     OR v_trigger_type <> 5
     OR v_trigger_function_oid <> v_function_oid THEN
    RAISE EXCEPTION 'trigger possui configuracao inesperada';
  END IF;

  SELECT p.prosecdef, p.proconfig
    INTO v_function_security_definer, v_function_config
    FROM pg_catalog.pg_proc p
   WHERE p.oid = v_function_oid;

  IF NOT v_function_security_definer
     OR NOT COALESCE(v_function_config @> ARRAY['search_path=public']::text[], false) THEN
    RAISE EXCEPTION 'funcao possui seguranca ou search_path inesperados';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION pg_temp.p2_comment_auth_trigger()
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  v_relation_oid oid := pg_catalog.to_regclass('auth.users');
  v_can_comment boolean;
BEGIN
  PERFORM pg_temp.p2_assert_auth_trigger();

  SELECT c.relowner = pg_catalog.to_regrole(current_user)::oid OR r.rolsuper
    INTO v_can_comment
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_roles r ON r.rolname = current_user
   WHERE c.oid = v_relation_oid;

  IF v_can_comment THEN
    EXECUTE pg_catalog.format(
      'COMMENT ON TRIGGER on_auth_user_created ON auth.users IS %L',
      'Cria o profile primario seguro para novos usuarios Auth; super_admin nunca nasce de metadata.'
    );
    RETURN 'COMMENTED';
  END IF;

  RETURN 'SKIPPED';
END;
$function$;

CREATE OR REPLACE FUNCTION pg_temp.p2_wrong_trigger_function()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;

-- Caso 1: executor nao owner preserva o trigger e omite apenas o comentario.
SET LOCAL ROLE postgres;
DO $test$
BEGIN
  IF pg_temp.p2_comment_auth_trigger() <> 'SKIPPED' THEN
    RAISE EXCEPTION 'caso 1 nao omitiu o comentario';
  END IF;
  PERFORM pg_temp.p2_assert_auth_trigger();
END;
$test$;
RESET ROLE;

-- Caso 2: owner legitimo aplica o comentario e preserva o trigger.
SET LOCAL ROLE supabase_auth_admin;
DO $test$
DECLARE
  v_comment text;
BEGIN
  IF pg_temp.p2_comment_auth_trigger() <> 'COMMENTED' THEN
    RAISE EXCEPTION 'caso 2 nao aplicou o comentario';
  END IF;

  SELECT pg_catalog.obj_description(t.oid, 'pg_trigger')
    INTO v_comment
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'auth.users'::regclass
     AND t.tgname = 'on_auth_user_created'
     AND NOT t.tgisinternal;

  IF v_comment <> 'Cria o profile primario seguro para novos usuarios Auth; super_admin nunca nasce de metadata.' THEN
    RAISE EXCEPTION 'caso 2 gravou comentario inesperado';
  END IF;
END;
$test$;
RESET ROLE;

-- Caso 3: trigger ausente falha fechado e o sub-bloco restaura o estado.
DO $test$
DECLARE
  v_falhou boolean := false;
BEGIN
  BEGIN
    DROP TRIGGER on_auth_user_created ON auth.users;
    PERFORM pg_temp.p2_assert_auth_trigger();
  EXCEPTION WHEN OTHERS THEN
    v_falhou := SQLERRM LIKE '%encontrados 0%';
  END;

  IF NOT v_falhou THEN
    RAISE EXCEPTION 'caso 3 nao falhou como esperado';
  END IF;
END;
$test$;

-- Caso 4: trigger ligado a funcao errada falha fechado.
DO $test$
DECLARE
  v_falhou boolean := false;
BEGIN
  BEGIN
    DROP TRIGGER on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION pg_temp.p2_wrong_trigger_function();
    PERFORM pg_temp.p2_assert_auth_trigger();
  EXCEPTION WHEN OTHERS THEN
    v_falhou := SQLERRM LIKE '%configuracao inesperada%';
  END;

  IF NOT v_falhou THEN
    RAISE EXCEPTION 'caso 4 nao falhou como esperado';
  END IF;
END;
$test$;

-- Caso 5: o catalogo impede trigger duplicado por relacao e nome.
DO $test$
DECLARE
  v_falhou boolean := false;
  v_catalogo_unico boolean;
BEGIN
  SELECT i.indisunique
    INTO v_catalogo_unico
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
   WHERE idx.relname = 'pg_trigger_tgrelid_tgname_index';

  IF NOT COALESCE(v_catalogo_unico, false) THEN
    RAISE EXCEPTION 'caso 5 nao encontrou garantia unica do catalogo';
  END IF;

  BEGIN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_new_user();
  EXCEPTION WHEN duplicate_object THEN
    v_falhou := true;
  END;

  IF NOT v_falhou THEN
    RAISE EXCEPTION 'caso 5 permitiu trigger duplicado';
  END IF;
END;
$test$;

-- Caso 6: comentario existente pode ser reaplicado de forma idempotente.
SET LOCAL ROLE supabase_auth_admin;
COMMENT ON TRIGGER on_auth_user_created ON auth.users IS 'comentario anterior';
DO $test$
DECLARE
  v_comment text;
BEGIN
  IF pg_temp.p2_comment_auth_trigger() <> 'COMMENTED' THEN
    RAISE EXCEPTION 'caso 6 nao reaplicou o comentario';
  END IF;

  SELECT pg_catalog.obj_description(t.oid, 'pg_trigger')
    INTO v_comment
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'auth.users'::regclass
     AND t.tgname = 'on_auth_user_created'
     AND NOT t.tgisinternal;

  IF v_comment <> 'Cria o profile primario seguro para novos usuarios Auth; super_admin nunca nasce de metadata.' THEN
    RAISE EXCEPTION 'caso 6 terminou com comentario inesperado';
  END IF;
END;
$test$;
RESET ROLE;

-- Caso 7: erro de permissao em DDL funcional continua propagando 42501.
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_falhou boolean := false;
BEGIN
  BEGIN
    DROP TRIGGER on_auth_user_created ON auth.users;
  EXCEPTION WHEN insufficient_privilege THEN
    v_falhou := SQLSTATE = '42501';
  END;

  IF NOT v_falhou THEN
    RAISE EXCEPTION 'caso 7 nao propagou a falha funcional esperada';
  END IF;
END;
$test$;
RESET ROLE;

SELECT pg_temp.p2_assert_auth_trigger();

SELECT 'P2_TRIGGER_INTEGRITY_TESTS=PASS' AS resultado;

ROLLBACK;
