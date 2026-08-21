BEGIN;

-- P0 (ajuste final do BOOTSTRAP de fundo virgem): financeiro_fundo_virgem
-- confundia MERA EXISTENCIA de arquivo/base publicada com evidencia
-- economica real. Uma importacoes_financeiras PUBLICADA de tipo_base
-- ESTOQUE/AQUISICOES/LIQUIDACOES pode nao representar nenhum movimento
-- real -- uma declaracao_sem_movimento (AQUISICOES/LIQUIDACOES) ou um
-- ESTOQUE publicado com zero posicoes sao, por definicao, a AUSENCIA de
-- posicao/movimento, nao a presenca. Confirmado ao vivo: o fundo real RLX
-- FLUOROCHEMICAL (que so tem uma declaracao_sem_movimento em AQUISICOES e
-- nenhuma operacao jamais incorporada) estava sendo classificado como
-- NAO-virgem so por essa declaracao vazia existir -- exatamente o erro que
-- este ticket pede para corrigir.
--
-- Corrigido: em vez de checar a EXISTENCIA de qualquer importacao publicada
-- desses tipos, o predicado agora checa a EXISTENCIA de ao menos uma linha
-- real nas tabelas canonicas de posicao/movimento (estoque_posicoes,
-- aquisicao_movimentos, liquidacao_movimentos) -- que so recebem linhas
-- quando ha dado real (declaracao_sem_movimento e ESTOQUE vazio nunca
-- inserem nenhuma linha nessas tabelas, por construcao de
-- publicar_importacao_financeira). O fato de "operacao com cessao
-- efetivada" permanece inalterado -- ja era o fato economico correto.
--
-- NAO encerram bootstrap (nenhuma linha real inserida): primeira Carteira
-- oficial pos-aporte; AQUISICOES/LIQUIDACOES com declaracao_sem_movimento;
-- ESTOQUE publicado com zero posicoes.
-- ENCERRAM bootstrap (fato economico real, irreversivel, sem reentrada):
-- primeira operacao com cessao_efetivada_em; primeira linha real em
-- estoque_posicoes/aquisicao_movimentos/liquidacao_movimentos.

CREATE OR REPLACE FUNCTION private.financeiro_fundo_virgem(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT NOT (
    EXISTS (
      SELECT 1 FROM public.operacoes o
      JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
      WHERE cf.fundo_id = p_fundo_id
        AND o.status IN ('em_andamento', 'inadimplente', 'liquidada')
        AND o.cessao_efetivada_em IS NOT NULL
    )
    OR EXISTS (SELECT 1 FROM public.estoque_posicoes p WHERE p.fundo_id = p_fundo_id)
    OR EXISTS (SELECT 1 FROM public.aquisicao_movimentos m WHERE m.fundo_id = p_fundo_id)
    OR EXISTS (SELECT 1 FROM public.liquidacao_movimentos m WHERE m.fundo_id = p_fundo_id)
  );
$$;
REVOKE ALL ON FUNCTION private.financeiro_fundo_virgem(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.financeiro_fundo_virgem(uuid) TO service_role;

COMMIT;
