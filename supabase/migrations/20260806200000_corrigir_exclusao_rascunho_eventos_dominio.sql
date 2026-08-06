-- Impede que a exclusao de uma NF deixe eventos de dominio sem entidade.
--
-- A FK eventos_dominio.nota_fiscal_id usa ON DELETE SET NULL, enquanto a
-- constraint eventos_dominio_entidade_check exige ao menos uma entidade entre
-- nota_fiscal_id e operacao_id. Eventos exclusivos da NF precisam, portanto,
-- ser removidos antes da exclusao da nota. Eventos tambem vinculados a uma
-- operacao sao preservados e passam a referenciar somente a operacao.

BEGIN;

CREATE OR REPLACE FUNCTION public.preparar_exclusao_nota_fiscal_eventos_dominio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.eventos_dominio evento
  WHERE evento.nota_fiscal_id = OLD.id
    AND evento.operacao_id IS NULL;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.preparar_exclusao_nota_fiscal_eventos_dominio() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preparar_exclusao_nota_fiscal_eventos_dominio() FROM anon;
REVOKE ALL ON FUNCTION public.preparar_exclusao_nota_fiscal_eventos_dominio() FROM authenticated;

DROP TRIGGER IF EXISTS notas_fiscais_preparar_exclusao_eventos_dominio
  ON public.notas_fiscais;

CREATE TRIGGER notas_fiscais_preparar_exclusao_eventos_dominio
BEFORE DELETE ON public.notas_fiscais
FOR EACH ROW
EXECUTE FUNCTION public.preparar_exclusao_nota_fiscal_eventos_dominio();

COMMIT;
