-- R1.16 FWD-06: only the two approved legacy policies; no ownership compensation.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public, private;

DO $r116$
DECLARE
  r record;
  p record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('devedores_solidarios','Cedentes podem ver seus devedores','(cedente_id IN ( SELECT cedentes.id
   FROM cedentes
  WHERE (cedentes.user_id = auth.uid())))'),
    ('taxas_cedente','taxas_cedente_select','((get_user_role() = ''cedente''::text) AND (cedente_id = get_user_cedente_id()))')
  ) AS approved(table_name,policy_name,expected_using)
  LOOP
    SELECT * INTO p FROM pg_policies WHERE schemaname='public' AND tablename=r.table_name AND policyname=r.policy_name;
    IF FOUND THEN
      IF p.cmd IS DISTINCT FROM 'SELECT' OR p.permissive IS DISTINCT FROM 'PERMISSIVE'
         OR p.roles::text[] IS DISTINCT FROM ARRAY['public']::text[]
         OR p.qual IS DISTINCT FROM r.expected_using OR p.with_check IS NOT NULL THEN
        RAISE EXCEPTION 'R1_16_POLICY_UNEXPECTED_DEFINITION: %',r.policy_name;
      END IF;
      EXECUTE format('DROP POLICY %I ON public.%I',r.policy_name,r.table_name);
    END IF;
    IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=r.table_name AND policyname=r.policy_name) THEN
      RAISE EXCEPTION 'R1_16_LEGACY_POLICY_REMAINS: %',r.policy_name;
    END IF;
  END LOOP;
END;
$r116$;
COMMIT;
