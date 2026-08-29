import { describe, expect, it } from 'vitest'
import { montarIdempotencyKeySolicitacaoOperacao } from './idempotencia'

const base = {
  userId: 'user-1',
  cedenteId: 'cedente-1',
  cedenteFundoId: 'vinculo-1',
  politicaVersaoId: 'versao-1',
}

describe('idempotencia de operacoes', () => {
  it('gera a mesma chave para a mesma solicitacao independente da ordem das NFs', () => {
    const first = montarIdempotencyKeySolicitacaoOperacao({ ...base, nfIds: ['nf-2', 'nf-1'] })
    const second = montarIdempotencyKeySolicitacaoOperacao({ ...base, nfIds: ['nf-1', 'nf-2', 'nf-2'] })

    expect(first).toBe(second)
    expect(first).toHaveLength(64)
  })

  it('muda a chave quando o contexto operacional muda', () => {
    const original = montarIdempotencyKeySolicitacaoOperacao({ ...base, nfIds: ['nf-1'] })
    const outroVinculo = montarIdempotencyKeySolicitacaoOperacao({ ...base, cedenteFundoId: 'vinculo-2', nfIds: ['nf-1'] })
    const outraVersao = montarIdempotencyKeySolicitacaoOperacao({ ...base, politicaVersaoId: 'versao-2', nfIds: ['nf-1'] })

    expect(outroVinculo).not.toBe(original)
    expect(outraVersao).not.toBe(original)
  })
})
