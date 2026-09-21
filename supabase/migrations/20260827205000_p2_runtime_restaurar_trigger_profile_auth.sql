-- P2 runtime rehearsal: public.handle_new_user() foi endurecida no SA0, mas a
-- cadeia canônica não recriou o trigger de auth.users. Convites geravam a
-- identidade Auth sem o profile exigido pelas RPCs de provisionamento.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

DO $p2_auth_trigger$
DECLARE
  v_relation_oid oid := pg_catalog.to_regclass('auth.users');
  v_function_oid oid := pg_catalog.to_regprocedure('public.handle_new_user()');
  v_trigger_count bigint;
  v_trigger_enabled "char";
  v_trigger_type smallint;
  v_trigger_function_oid oid;
  v_function_security_definer boolean;
  v_function_config text[];
  v_can_comment boolean;
BEGIN
  IF v_relation_oid IS NULL OR v_function_oid IS NULL THEN
    RAISE EXCEPTION 'P2 Auth: relacao ou funcao obrigatoria ausente';
  END IF;

  SELECT pg_catalog.count(*)
    INTO v_trigger_count
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = v_relation_oid
     AND t.tgname = 'on_auth_user_created'
     AND NOT t.tgisinternal;

  IF v_trigger_count <> 1 THEN
    RAISE EXCEPTION 'P2 Auth: esperado exatamente 1 trigger on_auth_user_created em auth.users, encontrados %',
      v_trigger_count;
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
    RAISE EXCEPTION 'P2 Auth: trigger on_auth_user_created possui configuracao inesperada';
  END IF;

  SELECT p.prosecdef, p.proconfig
    INTO v_function_security_definer, v_function_config
    FROM pg_catalog.pg_proc p
   WHERE p.oid = v_function_oid;

  IF NOT v_function_security_definer
     OR NOT COALESCE(v_function_config @> ARRAY['search_path=public']::text[], false) THEN
    RAISE EXCEPTION 'P2 Auth: public.handle_new_user() possui seguranca ou search_path inesperados';
  END IF;

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
  ELSE
    RAISE NOTICE 'P2 Auth: comentario documental do trigger omitido; executor % nao e owner de auth.users',
      current_user;
  END IF;
END;
$p2_auth_trigger$;
