-- Escopo 1: toda NF nova permanece em rascunho ate a submissao explicita do cedente.
-- A data e o ator da submissao sao metadados historicos; nao alteram os estados
-- existentes nem retroagem NFs ja submetidas/aprovadas.

ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS submetida_em timestamptz,
  ADD COLUMN IF NOT EXISTS submetida_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.notas_fiscais.submetida_em IS
  'Momento da submissao manual explicita da NF para analise.';
COMMENT ON COLUMN public.notas_fiscais.submetida_por IS
  'Usuario cedente que realizou a submissao manual explicita da NF.';

CREATE INDEX IF NOT EXISTS idx_notas_fiscais_submetida_em
  ON public.notas_fiscais(submetida_em DESC)
  WHERE submetida_em IS NOT NULL;
