-- Escopo 3: os campos categoria/escopo e bloqueia_fluxo permanecem no modelo
-- por compatibilidade, mas passam a ser projecoes dos campos canonicos
-- momento_obrigatorio e obrigatorio.
--
-- Esta migration nao corrige registros antigos e nao altera versoes publicadas.
-- Se houver divergencia em outro ambiente, a aplicacao deve ser interrompida
-- para diagnostico individual, preservando o historico.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.politica_requisitos_documentais
    WHERE momento_obrigatorio IS NULL
       OR momento_obrigatorio NOT IN ('nf_pre_cessao', 'operacao', 'pos_cessao', 'entrega')
       OR escopo IS DISTINCT FROM momento_obrigatorio
       OR categoria IS DISTINCT FROM momento_obrigatorio
       OR bloqueia_fluxo IS DISTINCT FROM obrigatorio
  ) THEN
    RAISE EXCEPTION
      'Existem requisitos documentais legados com campos derivados divergentes. Execute o diagnostico do Escopo 3 antes de aplicar constraints.';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.politica_requisitos_documentais'::regclass
      AND conname = 'politica_requisitos_momento_canonico_check'
  ) THEN
    ALTER TABLE public.politica_requisitos_documentais
      ADD CONSTRAINT politica_requisitos_momento_canonico_check
      CHECK (
        momento_obrigatorio IS NOT NULL
        AND momento_obrigatorio IN ('nf_pre_cessao', 'operacao', 'pos_cessao', 'entrega')
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.politica_requisitos_documentais'::regclass
      AND conname = 'politica_requisitos_categoria_derivada_check'
  ) THEN
    ALTER TABLE public.politica_requisitos_documentais
      ADD CONSTRAINT politica_requisitos_categoria_derivada_check
      CHECK (
        escopo = momento_obrigatorio
        AND categoria = momento_obrigatorio
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.politica_requisitos_documentais'::regclass
      AND conname = 'politica_requisitos_bloqueio_derivado_check'
  ) THEN
    ALTER TABLE public.politica_requisitos_documentais
      ADD CONSTRAINT politica_requisitos_bloqueio_derivado_check
      CHECK (bloqueia_fluxo = obrigatorio);
  END IF;
END;
$$;

COMMENT ON COLUMN public.politica_requisitos_documentais.momento_obrigatorio IS
  'Campo canonico do momento operacional do requisito.';
COMMENT ON COLUMN public.politica_requisitos_documentais.categoria IS
  'Campo derivado de momento_obrigatorio, mantido por compatibilidade.';
COMMENT ON COLUMN public.politica_requisitos_documentais.bloqueia_fluxo IS
  'Campo derivado de obrigatorio, mantido por compatibilidade.';
