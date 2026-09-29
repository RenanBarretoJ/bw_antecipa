import { createHash } from 'crypto'
import { normalizarTaxaOperacao } from './taxa-operacao'

export function montarIdempotencyKeySolicitacaoOperacao(input: {
  userId: string
  cedenteId: string
  cedenteFundoId: string
  politicaVersaoId: string
  nfIds: string[]
  taxaPropostaConsultor?: string | number | null
}) {
  const taxaProposta = input.taxaPropostaConsultor === undefined || input.taxaPropostaConsultor === null
    ? null
    : normalizarTaxaOperacao(input.taxaPropostaConsultor)

  if (input.taxaPropostaConsultor !== undefined && input.taxaPropostaConsultor !== null && taxaProposta === null) {
    throw new Error('Taxa proposta invalida para a chave de idempotencia.')
  }

  return createHash('sha256')
    .update([
      taxaProposta === null ? 'solicitacao-operacao-v1' : 'solicitacao-operacao-consultor-v2',
      input.userId,
      input.cedenteId,
      input.cedenteFundoId,
      input.politicaVersaoId,
      [...new Set(input.nfIds)].sort().join(','),
      ...(taxaProposta === null ? [] : [taxaProposta]),
    ].join('|'))
    .digest('hex')
}
