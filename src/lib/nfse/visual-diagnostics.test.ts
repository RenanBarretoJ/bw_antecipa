import { describe, expect, it } from 'vitest'
import { NfseVisualFiscalError, safeNfseVisualDiagnostic } from './visual-diagnostics'
import { validateVisualNfse } from './visual-contract'
import { visualFixture } from './fixtures/visual'

describe('safe visual fiscal diagnostics', () => {
  it.each([
    ['chave_acesso_nfse', 'invalid-secret-key', 'nfse_chave_acesso_invalid'],
    ['prestador_cnpj', '11.222.333/0001-00', 'nfse_cnpj_emitente_invalid'],
    ['data_emissao', '31/02/2026', 'nfse_data_emissao_invalid'],
    ['competencia', null, 'competencia_missing'],
    ['valor_liquido_nfse', 'R$ 0,00', 'net_non_positive'],
    ['valor_liquido_nfse', 'R$ 999.999,00', 'net_exceeds_gross'],
    ['total_retencoes', 'R$ 1,00', 'nfse_totals_arithmetic_review_required'],
  ] as const)('identifies %s without retaining its value', (field, value, reason) => {
    const input = visualFixture()
    input[field].value = value
    let caught: unknown
    try { validateVisualNfse(input) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(NfseVisualFiscalError)
    expect((caught as Error).message).toBe('NFSE_VISUAL_FISCAL_CONFLICT')
    expect(safeNfseVisualDiagnostic(caught)?.reasons).toContain(reason)
    const serialized = JSON.stringify(caught)
    if (value !== null) expect(serialized).not.toContain(value)
    expect(serialized).not.toContain(input.tomador_nome.value)
    expect(caught).not.toHaveProperty('cause')
  })
  it('only allows static identifiers at construction and again at logging', () => {
    const error = new NfseVisualFiscalError({ ok: false,
      failedFields: ['chave_acesso'], reasons: ['nfse_chave_acesso_invalid', 'secret payload'],
    }, ['unknown fiscal value'], ['net_non_positive', 'arbitrary-provider-error'])
    error.diagnostic.reasons.push('injected value')
    expect(safeNfseVisualDiagnostic(error)).toEqual({ failed_fields: ['chave_acesso'],
      reasons: ['nfse_chave_acesso_invalid', 'net_non_positive'] })
  })
  it('does not trust error-shaped provider objects or general errors', () => {
    for (const error of [new Error('secret'), { message: 'NFSE_VISUAL_FISCAL_CONFLICT',
      diagnostic: { failed_fields: ['secret'], reasons: ['secret'] } }, null]) {
      expect(safeNfseVisualDiagnostic(error)).toBeUndefined()
    }
  })
})
