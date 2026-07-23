import { createHash } from 'crypto'

export function montarIdempotencyKeySolicitacaoOperacao(input: {
  userId: string
  cedenteId: string
  cedenteFundoId: string
  politicaVersaoId: string
  nfIds: string[]
}) {
  return createHash('sha256')
    .update([
      'solicitacao-operacao-v1',
      input.userId,
      input.cedenteId,
      input.cedenteFundoId,
      input.politicaVersaoId,
      [...new Set(input.nfIds)].sort().join(','),
    ].join('|'))
    .digest('hex')
}
