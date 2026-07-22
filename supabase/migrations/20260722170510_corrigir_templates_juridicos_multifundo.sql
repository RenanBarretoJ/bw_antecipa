-- Correção Fase Templates Jurídicos:
-- 1) inclui contrato_mae_sem_coobrigacao como tipo jurídico controlado;
-- 2) garante unicidade multifundo por (fundo_id, codigo), evitando constraint global por codigo.

DO $$
DECLARE
  duplicate_count integer;
  constraint_name text;
BEGIN
  SELECT count(*)
  INTO duplicate_count
  FROM (
    SELECT fundo_id, codigo
    FROM public.templates_documentos
    GROUP BY fundo_id, codigo
    HAVING count(*) > 1
  ) duplicated;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Existem templates_documentos duplicados para o mesmo fundo_id e codigo. Resolva os dados antes de aplicar a constraint multifundo.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.templates_documentos'::regclass
      AND conname = 'templates_documentos_tipo_check'
  ) THEN
    ALTER TABLE public.templates_documentos
      DROP CONSTRAINT templates_documentos_tipo_check;
  END IF;

  ALTER TABLE public.templates_documentos
    ADD CONSTRAINT templates_documentos_tipo_check
    CHECK (tipo_documento IN (
      'contrato_mae',
      'contrato_mae_sem_coobrigacao',
      'termo_cessao',
      'notificacao_sacado',
      'termo_quitacao'
    ));

  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.templates_documentos'::regclass
      AND contype = 'u'
      AND conname <> 'templates_documentos_codigo_fundo_unique'
      AND (
        conkey = ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.templates_documentos'::regclass AND attname = 'codigo')
        ]::smallint[]
        OR conname = 'templates_documentos_codigo_unique'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.templates_documentos DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class idx
    JOIN pg_namespace ns ON ns.oid = idx.relnamespace
    WHERE ns.nspname = 'public'
      AND idx.relname = 'templates_documentos_codigo_unique'
      AND idx.relkind = 'i'
  ) THEN
    DROP INDEX IF EXISTS public.templates_documentos_codigo_unique;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.templates_documentos'::regclass
      AND contype = 'u'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.templates_documentos'::regclass AND attname = 'fundo_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.templates_documentos'::regclass AND attname = 'codigo')
      ]::smallint[]
  ) THEN
    ALTER TABLE public.templates_documentos
      ADD CONSTRAINT templates_documentos_codigo_fundo_unique UNIQUE (fundo_id, codigo);
  END IF;
END $$;
