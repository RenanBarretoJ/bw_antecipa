-- P7.4.1: a Central de Conciliacao consulta a linhagem das bases com a
-- sessao autenticada do Gestor. A policy existente permanece dedicada ao
-- Super Admin; esta policy adicional autoriza somente o fundo operacional
-- validado pelo helper canonico multifundo.
BEGIN;

DO $p741_preconditions$
BEGIN
  IF to_regclass('public.importacoes_financeiras') IS NULL THEN
    RAISE EXCEPTION 'P7.4.1: tabela public.importacoes_financeiras ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.importacoes_financeiras'::regclass
      AND attname = 'fundo_id'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'P7.4.1: coluna importacoes_financeiras.fundo_id ausente';
  END IF;

  IF to_regprocedure('private.financeiro_gestor_tem_acesso_fundo(uuid)') IS NULL THEN
    RAISE EXCEPTION 'P7.4.1: helper canonico de autorizacao financeira ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'importacoes_financeiras'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'P7.4.1: RLS nao esta habilitado em importacoes_financeiras';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.importacoes_financeiras', 'SELECT') THEN
    RAISE EXCEPTION 'P7.4.1: grant SELECT de authenticated ausente';
  END IF;

  IF has_table_privilege('anon', 'public.importacoes_financeiras', 'SELECT') THEN
    RAISE EXCEPTION 'P7.4.1: acesso anonimo inesperado em importacoes_financeiras';
  END IF;
END
$p741_preconditions$;

DO $p741_policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'importacoes_financeiras'
      AND policyname = 'importacoes_gestor_fundo_select'
  ) THEN
    CREATE POLICY importacoes_gestor_fundo_select
      ON public.importacoes_financeiras
      FOR SELECT
      TO authenticated
      USING (private.financeiro_gestor_tem_acesso_fundo(fundo_id));
  END IF;
END
$p741_policy$;

COMMENT ON POLICY importacoes_gestor_fundo_select ON public.importacoes_financeiras IS
  'Permite ao Gestor ler somente importacoes financeiras dos fundos vinculados e ativos.';

DO $p741_postconditions$
DECLARE
  target_policy pg_policies%ROWTYPE;
BEGIN
  SELECT *
  INTO target_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'importacoes_financeiras'
    AND policyname = 'importacoes_gestor_fundo_select';

  IF NOT FOUND
     OR target_policy.cmd <> 'SELECT'
     OR target_policy.permissive <> 'PERMISSIVE'
     OR target_policy.roles <> ARRAY['authenticated']::name[]
     OR target_policy.qual IS DISTINCT FROM 'private.financeiro_gestor_tem_acesso_fundo(fundo_id)' THEN
    RAISE EXCEPTION 'P7.4.1: policy de Gestor ausente ou divergente do contrato esperado';
  END IF;

  IF has_table_privilege('authenticated', 'public.importacoes_financeiras', 'INSERT')
     OR has_table_privilege('authenticated', 'public.importacoes_financeiras', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.importacoes_financeiras', 'DELETE') THEN
    RAISE EXCEPTION 'P7.4.1: privilegios de escrita de authenticated foram ampliados';
  END IF;
END
$p741_postconditions$;

NOTIFY pgrst, 'reload schema';

COMMIT;
