-- Completa o desacoplamento residual das politicas por fundo.
--
-- politicas_operacionais ja pertence ao fundo. As versoes e requisitos ainda
-- podem preservar cedente_fundo_id historico, mas novas versoes de catalogo do
-- fundo nao devem depender desse campo.

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
