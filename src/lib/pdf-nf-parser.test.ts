import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { extractDanfeFromText, valorTotalExtraidoValido } from './pdf-nf-parser'

describe('total financeiro do DANFE', () => {
  it.each([
    ['97.792,26', 97792.26],
    ['1.234,56', 1234.56],
    ['100,00', 100],
    ['R$ 97.792,26', 97792.26],
  ])('normaliza %s para %s', (texto, esperado) => {
    const resultado = extractDanfeFromText(`VALOR TOTAL DA NOTA ${texto}`)
    expect(resultado.valor_bruto).toBe(esperado)
    expect(resultado.valor_liquido).toBe(esperado)
    expect(resultado.origem_valor_bruto).toBe('valor_total_nota')
    expect(valorTotalExtraidoValido(resultado)).toBe(true)
  })

  it('prioriza o total da nota sobre produtos, frete, desconto e tributos', () => {
    const resultado = extractDanfeFromText([
      'VALOR DO ICMS 0,00',
      'VALOR TOTAL DOS PRODUTOS 90.000,00',
      'VALOR DO FRETE 7.792,26',
      'DESCONTO 0,00',
      'VALOR TOTAL DA NOTA R$ 97.792,26',
      'VALOR DA DUPLICATA 97.792,26',
    ].join('\n'))
    expect(resultado.valor_bruto).toBe(97792.26)
  })

  it('mantem o mesmo total com repeticao no canhoto, frete e desconto zerados', () => {
    const resultado = extractDanfeFromText([
      'VALOR DO FRETE 0,00',
      'DESCONTO 0,00',
      'VALOR TOTAL DOS PRODUTOS 97.792,26',
      'VALOR TOTAL DA NOTA R$ 97.792,26',
      'CANHOTO - VALOR TOTAL: R$ 97.792,26',
    ].join('\n'))
    expect(resultado.valor_bruto).toBe(97792.26)
    expect(resultado.origem_valor_bruto).toBe('valor_total_nota')
  })

  it('não confunde colunas concatenadas com o total do canhoto, mesmo em duas páginas', () => {
    const resultado = extractDanfeFromText([
      'VALOR TOTAL DA NOTA',
      '0,0097.792,260,000,000,000,00',
      'VALOR TOTAL DOS PRODUTOSVALOR DO ICMS ST',
      '0,000,000,00',
      '0,00',
      '97.792,26',
      'SALVADOR - BA - EMISSÃO: 16-09-2026 - VALOR TOTAL: R$ 97.792,26',
      '\f',
      'SALVADOR - BA - EMISSÃO: 16-09-2026 - VALOR TOTAL: R$ 97.792,26',
    ].join('\n'))
    expect(resultado.valor_bruto).toBe(97792.26)
    expect(resultado.data_emissao).toBe('2026-09-16')
  })

  it('falha fechado sem total, com zero, negativo ou valor não finito', () => {
    for (const texto of [
      'SEM TOTAL',
      'VALOR TOTAL DA NOTA 0,00',
      'VALOR TOTAL DA NOTA -100,00',
      'VALOR TOTAL DA NOTA\n0,0097.792,260,00\nVALOR TOTAL DOS PRODUTOS 97.792,26',
    ]) {
      expect(valorTotalExtraidoValido(extractDanfeFromText(texto))).toBe(false)
    }
    expect(valorTotalExtraidoValido({ campos_extraidos: [], valor_bruto: Number.NaN, origem_valor_bruto: 'valor_total_nota' })).toBe(false)
    expect(valorTotalExtraidoValido({ campos_extraidos: [], valor_bruto: Number.POSITIVE_INFINITY, origem_valor_bruto: 'valor_total_nota' })).toBe(false)
  })

  it('preserva a identificação da origem quando só há total de produtos', () => {
    const resultado = extractDanfeFromText('VALOR TOTAL DOS PRODUTOS R$ 1.234,56')
    expect(resultado.valor_bruto).toBe(1234.56)
    expect(resultado.origem_valor_bruto).toBe('valor_total_produtos')
  })

  it('bloqueia total inválido antes de Storage e INSERT no ramo PDF', () => {
    const action = readFileSync('src/lib/actions/nota-fiscal.ts', 'utf8')
    const pdfBranch = action.slice(action.indexOf('let extracted: NfPdfExtracted'), action.indexOf('export async function uploadNFs'))
    expect(pdfBranch).toContain('validarDanfeParaPersistencia(extracted)')
    expect(pdfBranch).toContain('!valorTotalExtraidoValido(extracted) || gateDanfe?.ok === false')
    expect(pdfBranch.indexOf('validarDanfeParaPersistencia(extracted)')).toBeLessThan(pdfBranch.indexOf('.from(buckets.notasFiscais).upload(filePath, arquivo)'))
    expect(pdfBranch.indexOf('validarDanfeParaPersistencia(extracted)')).toBeLessThan(pdfBranch.indexOf(".from('notas_fiscais')"))
    expect(pdfBranch).not.toContain('valor_bruto: extracted.valor_bruto ?? 0')
  })
})
