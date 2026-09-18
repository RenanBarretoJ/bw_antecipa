import { describe, expect, it } from 'vitest'
import { extractDanfeFromText, validarDanfeParaPersistencia, valorTotalExtraidoValido } from '../pdf-nf-parser'
import { parseDanfeMoney } from './money'

const EMITENTE = '12345678000195'
const DESTINATARIO = '11222333000181'

function keyFor(numero: number, serie: number, cnpj = EMITENTE): string {
  const body = `292609${cnpj}55${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}112345678`
  let sum = 0
  let weight = 2
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(body[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const remainder = sum % 11
  return body + (remainder < 2 ? 0 : 11 - remainder)
}

function gridDanfe(numero: number, totalPtBr: string, totalDot: string, icms = '0,00'): string {
  return [
    'IDENTIFICAÇÃO DO EMITENTE',
    'CNPJ / CPF',
    '12.345.678/0001-95',
    'CHAVE DE ACESSO',
    keyFor(numero, 2),
    'DANFE',
    'DESTINATÁRIO/REMETENTE',
    'RAZÃO SOCIAL CNPJ DATA DA EMISSÃO',
    `SACADO SINTETICO 11.222.333/0001-81 16/09/2026`,
    'DATA DA EMISSÃO 16/09/2026',
    `${numero}-01/01   31/10/2026   ${totalDot} |`,
    'FATURA / DUPLICATA',
    'CÁLCULO DO IMPOSTO',
    'BASE DE CÁLCULO DO ICMS VALOR DO ICMS BASE DE CÁLCULO DO ICMS ST VALOR DO ICMS ST VALOR TOTAL DOS PRODUTOS',
    'VALOR DO FRETE VALOR DO SEGURO DESCONTO OUTRAS DESPESAS ACESSÓRIAS VALOR DO IPI VALOR TOTAL DA NOTA',
    'TRANSPORTADOR / VOLUMES TRANSPORTADOS',
    icms,
    icms === '0,00' ? '0,00' : '41,00',
    '0,00',
    '0,00',
    totalPtBr,
    `0,000,000,000,00${totalPtBr}`,
  ].join('\n')
}

describe('parser DANFE multilayout', () => {
  it.each([
    [154806, '8.371,99', '8371.99', 8371.99, '0,00'],
    [154807, '10.966,02', '10966.02', 10966.02, '0,00'],
    [154808, '9.802,52', '9802.52', 9802.52, '0,00'],
    [154809, '1.026,60', '1026.60', 1026.60, '0,00'],
    [154810, '12.388,10', '12388.10', 12388.10, '200,00'],
  ])('grade fiscal/duplicata %i: total correto e campos com proveniencia', (numero, totalPtBr, totalDot, expected, icms) => {
    const parsed = extractDanfeFromText(gridDanfe(numero, totalPtBr, totalDot, icms))
    expect(parsed.numero_nf).toBe(String(numero))
    expect(parsed.serie).toBe('2')
    expect(parsed.cnpj_emitente).toBe(EMITENTE)
    expect(parsed.cnpj_destinatario).toBe(DESTINATARIO)
    expect(parsed.data_emissao).toBe('2026-09-16')
    expect(parsed.data_vencimento).toBe('2026-10-31')
    expect(parsed.valor_bruto).toBe(expected)
    expect(parsed.layout_fingerprint).toBe('fiscal_grid_after_labels')
    expect(parsed.confianca?.valor_bruto).toBeGreaterThanOrEqual(0.95)
    expect(parsed.proveniencia?.valor_bruto?.source).toBe('VALOR_TOTAL_DA_NOTA_TABELA')
    expect(parsed.proveniencia?.valor_bruto?.corroboratedBy).toContain('DUPLICATA_SUM')
    expect(validarDanfeParaPersistencia(parsed)).toEqual({ ok: true })
  })

  it('preserva o total canonico do canhoto em DANFE de duas paginas com colunas concatenadas', () => {
    const text = [
      'CHAVE DE ACESSO', keyFor(1741, 1),
      'DATA DA EMISSÃO 16/09/2026',
      'DESTINATÁRIO/REMETENTE',
      'SACADO SINTETICO 11.222.333/0001-81',
      'VALOR TOTAL DA NOTA',
      '0,0097.792,260,000,000,000,00',
      'SALVADOR - EMISSÃO: 16-09-2026 - VALOR TOTAL: R$ 97.792,26',
      '\f',
      'SALVADOR - EMISSÃO: 16-09-2026 - VALOR TOTAL: R$ 97.792,26',
    ].join('\n')
    const parsed = extractDanfeFromText(text)
    expect(parsed.numero_nf).toBe('1741')
    expect(parsed.serie).toBe('1')
    expect(parsed.valor_bruto).toBe(97792.26)
    expect(parsed.origem_valor_bruto).toBe('valor_total_nota')
    expect(validarDanfeParaPersistencia(parsed)).toEqual({ ok: true })
  })

  it('falha fechado quando duplicata e total canonico divergem', () => {
    const text = [
      'CHAVE DE ACESSO', keyFor(154806, 2),
      'DATA DA EMISSÃO 16/09/2026',
      'VALOR TOTAL DA NOTA R$ 8.371,99',
      '154806-01/01 31/10/2026 8372.99 |',
    ].join('\n')
    const parsed = extractDanfeFromText(text)
    expect(parsed.motivos_bloqueio).toContain('canonical_duplicate_conflict')
    expect(valorTotalExtraidoValido(parsed)).toBe(false)
    expect(validarDanfeParaPersistencia(parsed).ok).toBe(false)
  })

  it('valida produtos, frete e desconto quando os valores fiscais estao explicitos', () => {
    const correct = extractDanfeFromText([
      'VALOR TOTAL DOS PRODUTOS 90.000,00',
      'VALOR DO FRETE 7.792,26',
      'DESCONTO 0,00',
      'VALOR TOTAL DA NOTA R$ 97.792,26',
    ].join('\n'))
    expect(correct.valor_bruto).toBe(97792.26)
    expect(correct.motivos_bloqueio).not.toContain('fiscal_formula_conflict')

    const conflict = extractDanfeFromText([
      'VALOR TOTAL DOS PRODUTOS 90.000,00',
      'VALOR DO FRETE 7.792,26',
      'DESCONTO 0,00',
      'VALOR TOTAL DA NOTA R$ 98.792,26',
    ].join('\n'))
    expect(conflict.motivos_bloqueio).toContain('fiscal_formula_conflict')
    expect(valorTotalExtraidoValido(conflict)).toBe(false)
  })

  it('nao promove ICMS ou primeiro valor positivo quando falta a duplicata', () => {
    const text = gridDanfe(154810, '12.388,10', '12388.10', '200,00').replace(/154810-01\/01[^\n]+\n/, '')
    const parsed = extractDanfeFromText(text)
    expect(parsed.valor_bruto).toBe(12388.1)
    expect(valorTotalExtraidoValido(parsed)).toBe(false)
  })

  it('bloqueia duplicata quando a grade fiscal traz somente valores divergentes', () => {
    const text = gridDanfe(154810, '12.388,10', '12388.10', '200,00')
      .replaceAll('12.388,10', '12.300,00')
    const parsed = extractDanfeFromText(text)
    expect(parsed.motivos_bloqueio).toContain('fiscal_grid_duplicate_conflict')
    expect(validarDanfeParaPersistencia(parsed).ok).toBe(false)
  })

  it('bloqueia chave com DV errado e divergencia entre chave e emitente contextual', () => {
    const text = gridDanfe(154806, '8.371,99', '8371.99')
    const invalidKey = text.replace(keyFor(154806, 2), `${keyFor(154806, 2).slice(0, 43)}9`)
    expect(validarDanfeParaPersistencia(extractDanfeFromText(invalidKey)).ok).toBe(false)
    const issuerMismatch = text.replace('12.345.678/0001-95', '98.765.432/0001-10')
    expect(extractDanfeFromText(issuerMismatch).motivos_bloqueio).toContain('issuer_key_conflict')
  })

  it('bloqueia numero e serie do cabecalho quando divergem da chave validada', () => {
    const original = gridDanfe(154806, '8.371,99', '8371.99')
    const withHeader = original.replace('DANFE', 'DANFE\nNF-e N° 154806\nSERIE 2')
    expect(validarDanfeParaPersistencia(extractDanfeFromText(withHeader))).toEqual({ ok: true })
    const wrongNumber = withHeader.replace('NF-e N° 154806', 'NF-e N° 154807')
    expect(extractDanfeFromText(wrongNumber).motivos_bloqueio).toContain('invoice_key_conflict')
    expect(validarDanfeParaPersistencia(extractDanfeFromText(wrongNumber)).ok).toBe(false)
    const wrongSeries = withHeader.replace('SERIE 2', 'SERIE 3')
    expect(extractDanfeFromText(wrongSeries).motivos_bloqueio).toContain('series_key_conflict')
    expect(validarDanfeParaPersistencia(extractDanfeFromText(wrongSeries)).ok).toBe(false)
  })

  it.each(['8.371,99', '10.966,02', '1.026,60', '8371.99', '10966.02', '1026.60', '100,00', '0,00'])('aceita formato monetario explicito %s', (raw) => {
    expect(parseDanfeMoney(raw).ok).toBe(true)
  })

  it.each(['1.234', '1,234', '-100,00', '1,2', 'abc', '12.34,56'])('rejeita valor monetario ambiguo ou invalido %s', (raw) => {
    expect(parseDanfeMoney(raw).ok).toBe(false)
  })

  it('tolera espacos, tabs e quebra de linha entre blocos sem mudar o resultado', () => {
    const base = gridDanfe(154806, '8.371,99', '8371.99')
    for (let seed = 1; seed <= 25; seed += 1) {
      const variant = base.replace(/ +/g, seed % 2 ? '   ' : '\t').replace(/\n/g, seed % 3 ? '\n' : '\r\n')
      const parsed = extractDanfeFromText(variant)
      expect(parsed.valor_bruto).toBe(8371.99)
      expect(validarDanfeParaPersistencia(parsed).ok).toBe(true)
    }
  })

  it('aceita rotulo de total dividido em linhas com valor adjacente e sem R$', () => {
    const parsed = extractDanfeFromText([
      'VALOR TOTAL DA',
      'NOTA',
      '8.371,99',
    ].join('\n'))
    expect(parsed.valor_bruto).toBe(8371.99)
    expect(parsed.proveniencia?.valor_bruto?.source).toBe('VALOR_TOTAL_DA_NOTA')
    expect(valorTotalExtraidoValido(parsed)).toBe(true)
  })

  it('reconhece N.º sem chave apenas com emitente contextual inequívoco', () => {
    const parsed = extractDanfeFromText([
      'IDENTIFICAÇÃO DO EMITENTE', '12.345.678/0001-95',
      'N.º 154806', 'SÉRIE 2', 'DATA DA EMISSÃO 16/09/2026',
      'DESTINATÁRIO/REMETENTE', 'SACADO 11.222.333/0001-81',
      'VALOR TOTAL DA NOTA R$ 8.371,99',
    ].join('\n'))
    expect(parsed.numero_nf).toBe('154806')
    expect(parsed.serie).toBe('2')
    expect(parsed.cnpj_emitente).toBe(EMITENTE)
    expect(validarDanfeParaPersistencia(parsed)).toEqual({ ok: true })
  })

  it.each([
    ['NF-e\nNº. 000.006.942\nSÉRIE 1\nVALOR TOTAL DA NOTA 5.007,18', '000006942', '1', 5007.18],
    ['ELETRÔNICA Nº 9.700\nSÉRIE 3\nVALOR TOTAL DA NOTA 1.234,56', '9700', '3', 1234.56],
    ['N.º\nSÉRIE\n33850\nVALOR TOTAL DA NOTA 9.800,00', '33850', undefined, 9800],
  ])('preserva a leitura de numero e total dos layouts anteriores', (text, numero, serie, valor) => {
    const parsed = extractDanfeFromText(text)
    expect(parsed.numero_nf).toBe(numero)
    expect(parsed.serie).toBe(serie)
    expect(parsed.valor_bruto).toBe(valor)
  })

  it('sem total, sem numero ou sem emissor nao passa no gate de persistencia', () => {
    const noTotal = extractDanfeFromText(['CHAVE DE ACESSO', keyFor(154806, 2), 'DATA DA EMISSÃO 16/09/2026'].join('\n'))
    expect(validarDanfeParaPersistencia(noTotal)).toMatchObject({ ok: false, failedFields: ['valor_bruto'] })
    const noIdentity = extractDanfeFromText('VALOR TOTAL DA NOTA 8.371,99')
    expect(validarDanfeParaPersistencia(noIdentity)).toMatchObject({ ok: false, failedFields: expect.arrayContaining(['numero_nf', 'cnpj_emitente']) })
  })
})
