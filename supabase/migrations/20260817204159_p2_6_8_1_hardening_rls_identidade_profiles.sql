-- P2.6.8.1: profiles e usuario_papeis nao sao diretorios globais.
-- O browser autenticado conserva apenas o bootstrap da propria identidade.
BEGIN;

DO $p2_6_8_1_preconditions$
DECLARE
  gestor_policy pg_catalog.pg_policies%ROWTYPE;
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.usuario_papeis') IS NULL THEN
    RAISE EXCEPTION 'P2.6.8.1: tabelas canonicas de identidade ausentes';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'profiles'
       AND c.relrowsecurity IS TRUE
  ) THEN
    RAISE EXCEPTION 'P2.6.8.1: RLS de public.profiles deveria estar habilitada';
  END IF;

  SELECT *
    INTO gestor_policy
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'profiles'
     AND policyname = 'profiles_gestor_all';

  IF NOT FOUND
     OR gestor_policy.cmd <> 'ALL'
     OR gestor_policy.permissive <> 'PERMISSIVE'
     OR NOT ('public' = ANY (gestor_policy.roles))
     OR gestor_policy.qual !~* 'get_user_role\(\).*gestor' THEN
    RAISE EXCEPTION 'P2.6.8.1: profiles_gestor_all divergiu do estado conhecido';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'profiles'
       AND policyname = 'profiles_own_select'
       AND cmd = 'SELECT'
       AND 'authenticated' = ANY (roles)
       AND qual ~* 'auth.uid\(\)'
  ) THEN
    RAISE EXCEPTION 'P2.6.8.1: profiles_own_select ausente ou inesperada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'usuario_papeis'
       AND policyname = 'usuario_papeis_select_own'
       AND cmd = 'SELECT'
       AND 'authenticated' = ANY (roles)
       AND qual ~* 'auth.uid\(\)'
  ) THEN
    RAISE EXCEPTION 'P2.6.8.1: usuario_papeis_select_own ausente ou inesperada';
  END IF;
END
$p2_6_8_1_preconditions$;

DROP POLICY profiles_gestor_all ON public.profiles;

-- Nao existe consumidor runtime que atualize o proprio profile pela Data API.
-- Atualizacoes administrativas e de seguranca permanecem em fluxos server-side/RPC.
DROP POLICY IF EXISTS profiles_own_update ON public.profiles;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;

ALTER TABLE public.usuario_papeis ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.usuario_papeis FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.usuario_papeis TO authenticated;

DO $p2_6_8_1_postconditions$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'profiles'
       AND (
         policyname = 'profiles_gestor_all'
         OR (cmd = 'ALL' AND qual ~* 'get_user_role\(\).*gestor')
       )
  ) THEN
    RAISE EXCEPTION 'P2.6.8.1: autorizacao global de gestor ainda existe em profiles';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'profiles'
       AND policyname = 'profiles_own_select'
       AND cmd = 'SELECT'
       AND 'authenticated' = ANY (roles)
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'usuario_papeis'
       AND policyname = 'usuario_papeis_select_own'
       AND cmd = 'SELECT'
       AND 'authenticated' = ANY (roles)
  ) THEN
    RAISE EXCEPTION 'P2.6.8.1: contratos de leitura da propria identidade foram removidos';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.usuario_papeis', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated', 'public.usuario_papeis', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'P2.6.8.1: ACL de identidade permaneceu excessiva';
  END IF;
END
$p2_6_8_1_postconditions$;

COMMIT;
