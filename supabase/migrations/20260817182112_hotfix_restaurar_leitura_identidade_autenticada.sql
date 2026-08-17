-- Hotfix de identidade autenticada apos o hardening P2.6.4-P2.6.6.
-- A ACL permite a consulta, enquanto a RLS continua limitando cada usuario
-- ao proprio profile e aos proprios papeis.
BEGIN;

DO $hotfix_identity_preconditions$
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.usuario_papeis') IS NULL THEN
    RAISE EXCEPTION 'Hotfix de identidade: tabelas canonicas ausentes';
  END IF;
END
$hotfix_identity_preconditions$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON TABLE public.profiles FROM anon;
GRANT SELECT ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_own_select ON public.profiles;
CREATE POLICY profiles_own_select
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

ALTER TABLE public.usuario_papeis ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.usuario_papeis FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.usuario_papeis FROM authenticated;
GRANT SELECT ON TABLE public.usuario_papeis TO authenticated;

DROP POLICY IF EXISTS usuario_papeis_select_own ON public.usuario_papeis;
CREATE POLICY usuario_papeis_select_own
  ON public.usuario_papeis
  FOR SELECT
  TO authenticated
  USING (usuario_id = (SELECT auth.uid()));

COMMIT;
