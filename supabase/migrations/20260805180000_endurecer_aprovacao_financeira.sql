-- Endurece a aprovacao financeira depois da correcao da RPC aplicada em homologacao.
-- A funcao interna preserva o corpo ja validado; a assinatura publica passa a
-- recusar aprovacao repetida antes de executar qualquer efeito colateral.

BEGIN;

DROP INDEX IF EXISTS public.idx_operacao_calculo_nfs_operacao;

CREATE OR REPLACE FUNCTION public.bloquear_aprovacao_financeira_direta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'aprovada'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'aprovada')
     AND coalesce(current_setting('app.calculo_aprovacao', true), '') <> 'true' THEN
    RAISE EXCEPTION 'Aprovacao financeira deve ocorrer pela RPC atomica';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bloquear_aprovacao_financeira_direta() FROM PUBLIC;

DROP TRIGGER IF EXISTS operacoes_bloquear_aprovacao_financeira_direta
  ON public.operacoes;
CREATE TRIGGER operacoes_bloquear_aprovacao_financeira_direta
BEFORE INSERT OR UPDATE OF status ON public.operacoes
FOR EACH ROW
EXECUTE FUNCTION public.bloquear_aprovacao_financeira_direta();

ALTER FUNCTION public.aprovar_operacao_atomica(uuid, numeric)
  RENAME TO aprovar_operacao_atomica_financeiro_v1;

REVOKE ALL ON FUNCTION public.aprovar_operacao_atomica_financeiro_v1(uuid, numeric)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.aprovar_operacao_atomica(
  p_operacao_id uuid,
  p_taxa_desconto numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.get_user_role();
  operacao_status text;
  fundo_id_operacao uuid;
BEGIN
  IF actor_id IS NULL OR actor_role <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor autenticado pode aprovar operacao';
  END IF;

  IF p_taxa_desconto IS NULL OR p_taxa_desconto < 0 THEN
    RAISE EXCEPTION 'Taxa mensal invalida';
  END IF;

  SELECT o.status, cf.fundo_id
  INTO operacao_status, fundo_id_operacao
  FROM public.operacoes o
  JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
  WHERE o.id = p_operacao_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operacao nao encontrada';
  END IF;

  IF NOT private.usuario_tem_acesso_fundo(fundo_id_operacao) THEN
    RAISE EXCEPTION 'Gestor sem acesso ao fundo da operacao';
  END IF;

  IF operacao_status = 'aprovada' THEN
    RAISE EXCEPTION 'A operacao ja foi aprovada e nao pode ser aprovada novamente';
  END IF;

  IF operacao_status NOT IN ('solicitada', 'em_analise') THEN
    RAISE EXCEPTION 'Operacao com status % nao pode ser aprovada', operacao_status;
  END IF;

  RETURN public.aprovar_operacao_atomica_financeiro_v1(
    p_operacao_id,
    p_taxa_desconto
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aprovar_operacao_atomica(uuid, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_operacao_atomica(uuid, numeric)
  TO authenticated;

COMMIT;
