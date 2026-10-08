import { describe, expect, it } from 'vitest'
import { calculateFiscalNet } from './liquido-fiscal'
import { municipalFixture } from './fixtures/municipal'
import { validateMunicipalVisual } from './municipal-visual-contract'
import { prepareNfsePersistence } from './persistence'
import { fiscalFingerprint } from './review-facts'
import { resolverBaseAntecipacao } from '../operacoes/base-antecipacao'

// Synthetic identities, public-style retention labels. No customer PDF is committed.
const items = [
  { codigo: 'IRRF', valor: '8.056,42', rotulo: 'IRRF' },
  { codigo: 'PIS', valor: '3.491,12', rotulo: 'PIS/PASEP' },
  { codigo: 'COFINS', valor: '16.112,84', rotulo: 'COFINS' },
  { codigo: 'CSLL', valor: '5.370,95', rotulo: 'CSLL' },
]
const candidate = () => ({ ...municipalFixture(),
  valor_bruto: { label: 'VALOR TOTAL DA NOTA', value: '537.094,12' },
  retencoes: { completo: true, itens: items },
})

describe('fiscal net: explicit first, evidenced retentions second', () => {
  it('sums cents and subtracts retentions from gross', () => {
    const extraction = validateMunicipalVisual(candidate())
    expect(extraction.dados.valor_liquido).toBe(504062.79)
    expect(extraction.calculo_liquido?.total_retencoes).toBe(33031.33)
    const ready = prepareNfsePersistence(extraction, '2026-10-20', 'a'.repeat(64), '2026-10-05')
    expect(ready).toMatchObject({ kind: 'ready', values: { valor_liquido: 504062.79,
      valor_liquido_origem: 'CALCULADO_RETENCOES', fiscal_proveniencia: {
        calculo_liquido: { completo: true, total_retencoes: 33031.33 },
      } } })
  })
  it('preserves explicit net instead of replacing it with a derived value', () => {
    const result = validateMunicipalVisual({ ...candidate(), valor_liquido: { label: 'VALOR LIQUIDO', value: '500.000,00' } })
    expect(result.dados.valor_liquido).toBe(500000)
    expect(result.calculo_liquido).toBeUndefined()
    expect(prepareNfsePersistence(result,'2026-10-20','a'.repeat(64),'2026-10-05')).toMatchObject({
      values: { valor_liquido_origem: 'DOCUMENTO_EXPLICITO' },
    })
  })
  it.each([undefined, { completo: false, itens: items }, { completo: true, itens: [] }])('does not invent net from incomplete evidence', retencoes => {
    expect(validateMunicipalVisual({ ...candidate(), retencoes }).dados.valor_liquido).toBeUndefined()
  })
  it.each([
    [...items, items[0]],
    [{ codigo: 'ISS_RETIDO', valor: '10,00', rotulo: 'ISSQN devido' }],
    [{ codigo: 'IRRF', valor: '-1,00', rotulo: 'IRRF' }],
    [{ codigo: 'IRRF', valor: '537.094,12', rotulo: 'IRRF' }],
    [{ codigo: 'IRRF', valor: '8.056,42', rotulo: 'Aliquota IRRF' }],
    [{ codigo: 'JUROS', valor: '1,00', rotulo: 'Juros' }],
    [...items, { codigo: 'TOTAL_RETENCOES', valor: '33.031,33', rotulo: 'TOTAL DAS RETENCOES' }],
  ].map(itens => ({ itens })))('rejects ambiguous, duplicated or non-fiscal deductions', ({ itens }) => {
    expect(() => validateMunicipalVisual({ ...candidate(), retencoes: { completo: true, itens } })).toThrow()
  })
  it('retains evidence in review fingerprint and refuses calculation tampering', () => {
    const result = validateMunicipalVisual(candidate())
    const original = fiscalFingerprint(result)
    const changed = structuredClone(result)
    changed.calculo_liquido!.componentes[0].valor += 1
    expect(fiscalFingerprint(changed)).not.toBe(original)
    expect(() => prepareNfsePersistence(changed,'2026-10-20','a'.repeat(64),'2026-10-05')).toThrow('NFSE_NET_CALCULATION_INVALID')
  })
  it('allows the new certified origin in the existing financial base resolver, without changing pricing', () => {
    expect(resolverBaseAntecipacao('LIQUIDO', { valorBruto: 537094.12, valorLiquido: 504062.79,
      origemLiquido: 'CALCULADO_RETENCOES', possuiParcelas: false })).toEqual({ elegivel: true, base: 'LIQUIDO', valorBase: 504062.79 })
  })
  it.each([NaN, Infinity, -1, 1.001])('rejects invalid money %s', value => {
    expect(() => calculateFiscalNet(100,[{ codigo: 'IRRF', valor: value, rotulo: 'IRRF' }])).toThrow()
  })
  it('rejects unsupported codes even when a caller bypasses TypeScript', () => {
    // @ts-expect-error Runtime callers must be rejected as well as typed callers.
    expect(() => calculateFiscalNet(100,[{ codigo: 'JUROS', valor: 1, rotulo: 'Juros' }])).toThrow()
  })
})
