-- Novas duplicatas VRS: NF/parcela e NF/parcela-1. As chaves legadas permanecem validas.
-- Somente constraints de formato: sem DML, mudancas em grants, RLS, FKs ou unicidade.
ALTER TABLE public.remessa_operacional_chaves
  DROP CONSTRAINT remessa_operacional_chaves_ativo_check,
  ADD CONSTRAINT remessa_operacional_chaves_ativo_check CHECK (
    chave_unica_ativo ~ '^[A-Za-z0-9._-]{1,100}$'
    OR (char_length(chave_unica_ativo) <= 98 AND chave_unica_ativo ~ '^[0-9]+/[1-9][0-9]{0,2}$')
  ),
  DROP CONSTRAINT remessa_operacional_chaves_parcela_check,
  ADD CONSTRAINT remessa_operacional_chaves_parcela_check CHECK (
    chave_unica_parcela IS NULL
    OR chave_unica_parcela ~ '^[A-Za-z0-9._-]{1,100}$'
    OR (char_length(chave_unica_parcela) <= 100 AND chave_unica_parcela ~ '^[0-9]+/[1-9][0-9]{0,2}-1$')
  );
