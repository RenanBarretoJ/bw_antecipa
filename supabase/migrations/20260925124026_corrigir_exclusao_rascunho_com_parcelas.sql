-- Hotfix: parcelas pertencem ao rascunho e precisam ser removidas antes da NF.
-- Mantemos a FK RESTRICT para preservar a protecao estrutural fora deste fluxo.

BEGIN;

CREATE OR REPLACE FUNCTION private.preparar_exclusao_parcelas_nf_rascunho()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status::text = 'rascunho' THEN
    DELETE FROM public.nota_fiscal_parcelas parcela
    WHERE parcela.nota_fiscal_id = OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.preparar_exclusao_parcelas_nf_rascunho()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS preparar_exclusao_parcelas_nf_rascunho
  ON public.notas_fiscais;
CREATE TRIGGER preparar_exclusao_parcelas_nf_rascunho
  BEFORE DELETE ON public.notas_fiscais
  FOR EACH ROW
  EXECUTE FUNCTION private.preparar_exclusao_parcelas_nf_rascunho();

COMMENT ON FUNCTION private.preparar_exclusao_parcelas_nf_rascunho() IS
  'Remove parcelas filhas somente na exclusao de NF em rascunho; referencias operacionais RESTRICT continuam bloqueando a transacao.';

COMMIT;
