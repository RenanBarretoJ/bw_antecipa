-- Desacopla definitivamente politicas_operacionais do vinculo cedente_fundo.
--
-- Fonte de verdade apos esta migration:
--   fundos -> politicas_operacionais -> politica_operacional_versoes
--   cedente_fundos -> cedente_fundo_politicas -> politicas_operacionais
--
-- Operacoes e snapshots antigos permanecem com seus IDs historicos.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS public.politicas_operacionais
  ADD COLUMN IF NOT EXISTS fundo_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'politicas_operacionais'
      AND c.column_name = 'cedente_fundo_id'
  ) THEN
    UPDATE public.politicas_operacionais po
    SET fundo_id = cf.fundo_id
    FROM public.cedente_fundos cf
    WHERE po.cedente_fundo_id = cf.id
      AND po.fundo_id IS NULL;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'politicas_operacionais'
      AND column_name = 'cedente_fundo_id'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM public.politicas_operacionais po
      JOIN public.cedente_fundos cf ON cf.id = po.cedente_fundo_id
      WHERE po.fundo_id IS DISTINCT FROM cf.fundo_id
    ) THEN
      RAISE EXCEPTION 'Divergencia detectada: politicas_operacionais.fundo_id difere de cedente_fundos.fundo_id para politicas legadas.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.politicas_operacionais
    WHERE fundo_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Nao foi possivel resolver fundo_id para todas as politicas_operacionais.';
  END IF;
END;
$$;

ALTER TABLE IF EXISTS public.politica_operacional_versoes
  ADD COLUMN IF NOT EXISTS fundo_id uuid;

UPDATE public.politica_operacional_versoes pov
SET fundo_id = po.fundo_id
FROM public.politicas_operacionais po
WHERE pov.politica_operacional_id = po.id
  AND pov.fundo_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.politica_operacional_versoes
    WHERE fundo_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Nao foi possivel resolver fundo_id para todas as versoes de politica.';
  END IF;

  ALTER TABLE public.politica_operacional_versoes
    ALTER COLUMN fundo_id SET NOT NULL;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'politica_operacional_versoes'
      AND column_name = 'cedente_fundo_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.politica_operacional_versoes
      ALTER COLUMN cedente_fundo_id DROP NOT NULL;
  END IF;
END;
$$;

ALTER TABLE IF EXISTS public.politica_requisitos_documentais
  ADD COLUMN IF NOT EXISTS fundo_id uuid;

UPDATE public.politica_requisitos_documentais pr
SET fundo_id = COALESCE(pr.fundo_id, pov.fundo_id, po.fundo_id)
FROM public.politica_operacional_versoes pov
JOIN public.politicas_operacionais po ON po.id = pov.politica_operacional_id
WHERE pr.politica_operacional_versao_id = pov.id
  AND pr.fundo_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.politica_operacional_versoes publicada
    WHERE publicada.id = pr.politica_operacional_versao_id
      AND publicada.publicada_em IS NOT NULL
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'politica_requisitos_documentais'
      AND column_name = 'cedente_fundo_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.politica_requisitos_documentais
      ALTER COLUMN cedente_fundo_id DROP NOT NULL;
  END IF;
END;
$$;

DO $$
DECLARE
  has_legacy_column boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'politicas_operacionais'
      AND column_name = 'cedente_fundo_id'
  ) INTO has_legacy_column;

  IF has_legacy_column THEN
    INSERT INTO public.cedente_fundo_politicas (
      cedente_fundo_id,
      politica_operacional_id,
      status,
      vigente_desde,
      vigente_ate,
      atribuido_por,
      motivo
    )
    SELECT
      po.cedente_fundo_id,
      po.id,
      CASE
        WHEN po.status = 'ativa'
          AND NOT EXISTS (
            SELECT 1
            FROM public.cedente_fundo_politicas atual
            WHERE atual.cedente_fundo_id = po.cedente_fundo_id
              AND atual.status = 'ativa'
              AND atual.vigente_ate IS NULL
          )
          THEN 'ativa'
        ELSE 'encerrada'
      END,
      COALESCE(po.created_at, now()),
      CASE
        WHEN po.status = 'ativa'
          AND NOT EXISTS (
            SELECT 1
            FROM public.cedente_fundo_politicas atual
            WHERE atual.cedente_fundo_id = po.cedente_fundo_id
              AND atual.status = 'ativa'
              AND atual.vigente_ate IS NULL
          )
          THEN NULL
        ELSE COALESCE(po.updated_at, now())
      END,
      po.created_by,
      'Backfill: vinculo legado migrado de politicas_operacionais.cedente_fundo_id.'
    FROM public.politicas_operacionais po
    WHERE po.cedente_fundo_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.cedente_fundo_politicas cfp
        WHERE cfp.cedente_fundo_id = po.cedente_fundo_id
          AND cfp.politica_operacional_id = po.id
      );
  END IF;
END;
$$;

DO $$
DECLARE
  duplicate_record record;
BEGIN
  SELECT fundo_id, codigo, count(*) AS total
    INTO duplicate_record
  FROM public.politicas_operacionais
  GROUP BY fundo_id, codigo
  HAVING count(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Duplicidade de politica operacional por fundo/codigo detectada. fundo_id=%, codigo=%, total=%',
      duplicate_record.fundo_id,
      duplicate_record.codigo,
      duplicate_record.total;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.politicas_operacionais
    WHERE padrao = true
      AND status = 'ativa'
    GROUP BY fundo_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Mais de uma politica padrao ativa encontrada para o mesmo fundo.';
  END IF;
END;
$$;

ALTER TABLE public.politicas_operacionais
  ALTER COLUMN fundo_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'politicas_operacionais'
      AND con.contype = 'f'
      AND att.attname = 'fundo_id'
      AND con.confrelid = 'public.fundos'::regclass
  ) THEN
    ALTER TABLE public.politicas_operacionais
      ADD CONSTRAINT politicas_operacionais_fundo_id_fkey
      FOREIGN KEY (fundo_id)
      REFERENCES public.fundos(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

ALTER TABLE IF EXISTS public.politicas_operacionais
  DROP CONSTRAINT IF EXISTS politicas_operacionais_id_vinculo_unique,
  DROP CONSTRAINT IF EXISTS politicas_operacionais_vinculo_codigo_unique,
  DROP CONSTRAINT IF EXISTS politicas_operacionais_cedente_fundo_id_fkey;

DROP INDEX IF EXISTS public.uq_politicas_operacionais_ativas_vinculo;
DROP INDEX IF EXISTS public.idx_politicas_operacionais_vinculo_status;

DO $$
DECLARE
  index_record record;
  legacy_attnum int;
BEGIN
  SELECT attnum
    INTO legacy_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.politicas_operacionais'::regclass
    AND attname = 'cedente_fundo_id'
    AND NOT attisdropped;

  IF legacy_attnum IS NOT NULL THEN
    FOR index_record IN
      SELECT cls.relname AS index_name
      FROM pg_index idx
      JOIN pg_class cls ON cls.oid = idx.indexrelid
      WHERE idx.indrelid = 'public.politicas_operacionais'::regclass
        AND idx.indkey::text ~ ('(^| )' || legacy_attnum::text || '( |$)')
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS public.%I', index_record.index_name);
    END LOOP;
  END IF;
END;
$$;

DROP POLICY IF EXISTS politicas_operacionais_vinculo_select ON public.politicas_operacionais;

DROP POLICY IF EXISTS politicas_operacionais_fundo_select ON public.politicas_operacionais;
CREATE POLICY politicas_operacionais_fundo_select ON public.politicas_operacionais
  FOR SELECT TO authenticated
  USING (
    (SELECT get_user_role()) = 'gestor'
    OR EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.cedente_fundo_politicas cfp
        ON cfp.cedente_fundo_id = cf.id
       AND cfp.politica_operacional_id = politicas_operacionais.id
       AND cfp.status = 'ativa'
       AND cfp.vigente_desde <= now()
       AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
      WHERE cf.fundo_id = politicas_operacionais.fundo_id
        AND cf.status = 'ativo'
        AND cf.cedente_id = (SELECT get_user_cedente_id())
    )
  );

ALTER TABLE public.politicas_operacionais
  DROP COLUMN IF EXISTS cedente_fundo_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'politicas_operacionais'
      AND con.conname = 'politicas_operacionais_fundo_codigo_unique'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_class cls
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname = 'public'
      AND cls.relname = 'politicas_operacionais_fundo_codigo_unique'
  ) THEN
    ALTER TABLE public.politicas_operacionais
      ADD CONSTRAINT politicas_operacionais_fundo_codigo_unique UNIQUE (fundo_id, codigo);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_politicas_operacionais_padrao_fundo
  ON public.politicas_operacionais(fundo_id)
  WHERE padrao = true AND status = 'ativa';

CREATE INDEX IF NOT EXISTS idx_politicas_operacionais_fundo_status
  ON public.politicas_operacionais(fundo_id, status);
