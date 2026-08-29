-- Bridge de upgrade do schema legado de producao para o nome canonico usado
-- pela cadeia multifundo. A renomeacao preserva OID, dados, FKs, grants e RLS.
-- Esta migration deve ser executada como preflight antes de
-- 20260721123935_fase2_nucleo_multifundo_politicas_snapshot.sql.

DO $$
BEGIN
  IF to_regclass('public.consultor_cedente') IS NOT NULL
     AND to_regclass('public.consultor_cedentes') IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Bridge consultor bloqueada: tabelas singular e plural coexistem';
  END IF;

  IF to_regclass('public.consultor_cedente') IS NULL
     AND to_regclass('public.consultor_cedentes') IS NOT NULL THEN
    ALTER TABLE public.consultor_cedentes RENAME TO consultor_cedente;
  END IF;
END;
$$;

DO $$
DECLARE
  v_rename record;
BEGIN
  IF to_regclass('public.consultor_cedente') IS NULL THEN
    RETURN;
  END IF;

  FOR v_rename IN
    SELECT *
    FROM (VALUES
      ('consultor_cedentes_pkey', 'consultor_cedente_pkey'),
      ('consultor_cedentes_consultor_id_cedente_id_key', 'consultor_cedente_consultor_id_cedente_id_key'),
      ('consultor_cedentes_consultor_id_fkey', 'consultor_cedente_consultor_id_fkey'),
      ('consultor_cedentes_cedente_id_fkey', 'consultor_cedente_cedente_id_fkey')
    ) AS nomes(anterior, canonico)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = 'public.consultor_cedente'::regclass
        AND c.conname = v_rename.anterior
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = 'public.consultor_cedente'::regclass
        AND c.conname = v_rename.canonico
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.consultor_cedente RENAME CONSTRAINT %I TO %I',
        v_rename.anterior,
        v_rename.canonico
      );
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.consultor_cedente') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'consultor_cedente'
      AND policyname = 'consultor_cedentes_gestor'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'consultor_cedente'
      AND policyname = 'consultor_cedente_gestor_all'
  ) THEN
    ALTER POLICY consultor_cedentes_gestor
      ON public.consultor_cedente
      RENAME TO consultor_cedente_gestor_all;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'consultor_cedente'
      AND policyname = 'consultor_cedentes_consultor'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'consultor_cedente'
      AND policyname = 'consultor_cedente_select_own'
  ) THEN
    ALTER POLICY consultor_cedentes_consultor
      ON public.consultor_cedente
      RENAME TO consultor_cedente_select_own;
  END IF;
END;
$$;

COMMENT ON TABLE public.consultor_cedente IS
  'Vinculo canonico consultor x cedente; renomeado do legado consultor_cedentes no upgrade de producao.';
