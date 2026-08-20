BEGIN;

-- P0 Rejeicao/Cancelamento: liberarParcelasDaOperacao (src/lib/actions/operacao.ts)
-- faz UPDATE direto em nota_fiscal_parcelas e DELETE direto em
-- operacoes_nf_parcelas usando o client do Server Action (role authenticated).
-- Essas duas tabelas so tem GRANT SELECT para authenticated desde
-- 20260819210000/20260819230000 -- toda escrita deveria passar por RPC
-- SECURITY DEFINER. O resultado real (confirmado ao vivo em homolog): as
-- duas chamadas falham com "permission denied for table ..." e o erro e
-- descartado silenciosamente pelo codigo (nao ha checagem de { error } ali),
-- entao apos reprovar/cancelar uma operacao, as parcelas continuam
-- 'em_operacao' e o vinculo em operacoes_nf_parcelas nunca e removido -- a
-- NF volta a aparecer em "Nova Solicitacao" (pois notas_fiscais.status volta
-- para 'aprovada', tabela com GRANT completo), mas com 0 parcelas
-- disponiveis para expandir.
--
-- Esta migration adiciona a RPC que faltava, no mesmo padrao das RPCs irmas
-- (SECURITY DEFINER, autorizacao explicita por papel, escopada exatamente ao
-- que liberarParcelasDaOperacao ja tentava fazer): libera as parcelas
-- vinculadas a uma operacao ja reprovada/cancelada e remove o vinculo em
-- operacoes_nf_parcelas, atomicamente. operacoes_nfs NAO e alterado (segue
-- como historico, por design -- nao bloqueia nova selecao pois a trava por
-- NF-com-parcelas e feita por nota_fiscal_parcelas.status, nao por presenca
-- em operacoes_nfs).

CREATE OR REPLACE FUNCTION public.liberar_parcelas_operacao_rejeitada(
  p_operacao_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.get_user_role();
  op record;
  v_parcelas_liberadas integer := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  SELECT o.id, o.status, o.cedente_id, cf.fundo_id
  INTO op
  FROM public.operacoes o
  JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
  WHERE o.id = p_operacao_id
  FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operacao nao encontrada';
  END IF;

  IF actor_role = 'gestor' THEN
    IF NOT private.gestor_tem_acesso_cedente(op.cedente_id) THEN
      RAISE EXCEPTION 'Gestor sem vinculo ativo com o fundo desta operacao';
    END IF;
  ELSIF actor_role = 'cedente' THEN
    IF op.cedente_id <> (SELECT public.get_user_cedente_id()) THEN
      RAISE EXCEPTION 'Operacao fora do cedente autenticado';
    END IF;
  ELSE
    RAISE EXCEPTION 'Perfil sem permissao para liberar parcelas desta operacao';
  END IF;

  IF op.status NOT IN ('reprovada', 'cancelada') THEN
    RAISE EXCEPTION 'Operacao com status % nao permite liberar parcelas (esperado reprovada ou cancelada)', op.status;
  END IF;

  WITH parcelas_da_operacao AS (
    SELECT parcela_id FROM public.operacoes_nf_parcelas WHERE operacao_id = p_operacao_id
  )
  UPDATE public.nota_fiscal_parcelas p
  SET status = 'disponivel'
  WHERE p.id IN (SELECT parcela_id FROM parcelas_da_operacao);
  GET DIAGNOSTICS v_parcelas_liberadas = ROW_COUNT;

  DELETE FROM public.operacoes_nf_parcelas WHERE operacao_id = p_operacao_id;

  RETURN jsonb_build_object('operacao_id', p_operacao_id, 'parcelas_liberadas', v_parcelas_liberadas);
END;
$$;

REVOKE ALL ON FUNCTION public.liberar_parcelas_operacao_rejeitada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.liberar_parcelas_operacao_rejeitada(uuid) TO authenticated;

COMMENT ON FUNCTION public.liberar_parcelas_operacao_rejeitada(uuid) IS
  'Libera (status=disponivel) as parcelas vinculadas a uma operacao ja reprovada/cancelada e remove o vinculo em operacoes_nf_parcelas, atomicamente. Chamada por reprovarOperacao/cancelarOperacao no lugar de UPDATE/DELETE diretos, que falham silenciosamente (grant so tem SELECT nessas tabelas para authenticated).';

COMMIT;
