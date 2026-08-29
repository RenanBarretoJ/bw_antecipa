BEGIN;

-- P0/P1 (bootstrap fundo virgem): risco_motivos_codigo_check ainda nao
-- reconhecia o motivo canonico PL_OFICIAL_INDISPONIVEL (introduzido junto
-- com classificarGateRisco/RISK_REASON_CODES nesta mesma entrega) --
-- confirmado ao vivo em homologacao (persistir_risco_execucao rejeitando a
-- gravacao do motivo com "new row for relation risco_motivos violates check
-- constraint risco_motivos_codigo_check"). Corrigido apenas alargando a
-- lista de codigos aceitos; nenhum outro comportamento alterado.

ALTER TABLE public.risco_motivos DROP CONSTRAINT IF EXISTS risco_motivos_codigo_check;
ALTER TABLE public.risco_motivos ADD CONSTRAINT risco_motivos_codigo_check
  CHECK (codigo = ANY (ARRAY[
    'EXPOSICAO_ACIMA_LIMITE', 'PL_D2_INDISPONIVEL', 'PL_D2_INVALIDO', 'POSICAO_SEM_MATCH',
    'EXPOSICAO_INDETERMINADA', 'OPERACAO_NAO_INCORPORADA_ESTOQUE', 'VALOR_AQUISICAO_INDISPONIVEL',
    'VALOR_AQUISICAO_OPERACAO_INDISPONIVEL', 'LIQUIDACAO_PARCIAL_PRESENTE', 'NO_LIMITE',
    'AVALIACAO_RISCO_INDISPONIVEL', 'PL_OFICIAL_INDISPONIVEL'
  ]));

COMMIT;
