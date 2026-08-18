export type EstabelecimentoStatus = 'rascunho' | 'pendente' | 'aprovado' | 'rejeitado' | 'suspenso'
export type EstabelecimentoTipo = 'matriz' | 'filial'

export interface EstabelecimentoOrigem {
  id: string
  cedenteId: string
  cnpj: string
  razaoSocial: string
  tipo: EstabelecimentoTipo
  status: EstabelecimentoStatus
  ativo: boolean
}

export interface ComposicaoEstabelecimentosOperacao {
  cedenteId: string
  estabelecimentoIds: string[]
}

/**
 * FUTURE_DECISION_RULE_1.
 *
 * A composicao de CNPJs em uma operacao ainda nao foi definida. Este ponto
 * unico preserva o comportamento vigente sem certificar nem proibir mistura.
 */
export function validarComposicaoEstabelecimentosOperacao(
  input: ComposicaoEstabelecimentosOperacao,
): ComposicaoEstabelecimentosOperacao {
  return {
    cedenteId: input.cedenteId,
    estabelecimentoIds: [...new Set(input.estabelecimentoIds.filter(Boolean))],
  }
}
