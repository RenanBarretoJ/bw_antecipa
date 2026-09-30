import { describe, expect, it } from 'vitest'
import { NfseVisualContractError, NfseVisualFiscalError, safeNfseVisualDiagnostic } from './visual-diagnostics'
import { validateVisualNfse } from './visual-contract'
import { visualFixture } from './fixtures/visual'

describe('safe visual fiscal diagnostics', () => {
  it.each([
    [{ ambiguous: true }, 'ambiguous', 'invalid_value'],
    [{ confidence: 0.84 }, 'confidence', 'too_small'],
    [{ document_count: 2 }, 'document_count', 'invalid_value'],
    [{ fingerprint: 'private-provider-value' }, 'fingerprint', 'invalid_value'],
    [{ prestador_nome: { value: 123, label: null } }, 'prestador_nome.value', 'invalid_type'],
    [{ secret_extra_key: 'secret-value' }, 'document', 'unrecognized_keys'],
  ] as const)('explains contract rejection without keeping raw input %j', (override, field, code) => {
    let caught: unknown
    try { validateVisualNfse({ ...visualFixture(), ...override }) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(NfseVisualContractError)
    expect((caught as Error).message).toBe('NFSE_VISUAL_INVALID_CONTRACT')
    expect(safeNfseVisualDiagnostic(caught)).toEqual({ failed_fields: [], reasons: [], contract_issues: [{ field, code }] })
    const serialized = JSON.stringify(caught)
    for (const secret of ['private-provider-value', 'secret_extra_key', 'secret-value', 'PRESTADOR SINTETICO']) {
      expect(serialized).not.toContain(secret)
    }
    expect(caught).not.toHaveProperty('cause')
  })
  it('sanitizes unknown paths, issue codes and diagnostic tampering at the log boundary', () => {
    const error = new NfseVisualContractError([
      { path: ['secret-key'], code: 'private-error' },
      { path: ['prestador_nome', 'value', 'secret-child'], code: 'invalid_type' },
      { path: [Symbol('secret')], code: 'invalid_type' },
    ])
    error.diagnostic.contract_issues.push({ field: 'injected-value', code: 'injected-code' })
    expect(safeNfseVisualDiagnostic(error)).toEqual({ failed_fields: [], reasons: [], contract_issues: [
      { field: 'document', code: 'invalid_contract' }, { field: 'document', code: 'invalid_type' },
    ] })
    expect(safeNfseVisualDiagnostic({ message: error.message, diagnostic: error.diagnostic })).toBeUndefined()
  })
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
