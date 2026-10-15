import { describe, expect, it, vi } from 'vitest'
import { extractDanfeFromPdf, extractDanfeFromText, validarDanfeParaPersistencia } from '../pdf-nf-parser'
import { notaFiscalSchema } from '../validations/nf'
import { extractDanfeFatura } from './fatura'

function key(body = `292605${'12345678000195'}55${'001'}${'000056581'}1${'12345678'}`): string {
  let sum = 0
  for (let i = 42, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(body[i]) * weight
  const mod = sum % 11
  return body + (mod < 2 ? 0 : 11 - mod)
}

// Synthetic textual equivalent. No private PDF, medical or banking data.
const KEY = key()
const fixture = [
  'D A N F E', 'CHAVE DE ACESSO', KEY.match(/.{4}/g)!.join(' '),
  'N. 056581', 'SÉRIE 001', 'EMITENTE SINTETICO LTDA',
  'INSCRICAO ESTADUALINSCRICAO ESTADUAL DO SUBST.TRIB.CNPJ', '123456 12.345.678/0001-95',
  'DESTINATARIO/REMETENTE', 'NOME/RAZAO SOCIALCNPJ/CPFDATA DA EMISSAO',
  'SACADO SINTETICO 11.222.333/0001-8122/05/2026',
  'FATURA', '', '01 - 21/07/2026 - Val:     174.945,00', '',
  'CALCULO DO IMPOSTO',
  'BASE DE CALCULO DO ICMSVALOR DO ICMSBASE DE CALCULO DO ICMS STVALOR DO ICMS STVALOR TOTAL DOS PRODUTOS',
  '174.945,00 35.863,73 0,00 0,00 174.945,00',
  'VALOR FRETEVALOR DO SEGURODESCONTOOUTRAS DESPESAS ACESSORIASVALOR DO IPIVALOR TOTAL DA NOTA',
  '0,00 0,00 0,00 0,00 0,00 174.945,00',
  'TRANSPORTADOR / VOLUMES TRANSPORTADOS', 'TRANSPORTADOR SINTETICO 98.765.432/0001-10',
  'DADOS DOS PRODUTOS / SERVICOS', 'ITEM SINTETICO 174.945,00',
].join('\n')

describe('DANFE com FATURA numerada e Val (fixture sintética)', () => {
  it('confirma total pela fatura, conserva ICMS e extrai vencimento literal', () => {
    const p = extractDanfeFromText(fixture)
    expect(p).toMatchObject({ tipo_reconhecido: 'DANFE', numero_nf: '56581', serie: '1', chave_acesso: KEY,
      cnpj_emitente: '12345678000195', cnpj_destinatario: '11222333000181',
      razao_social_destinatario: 'SACADO SINTETICO', data_emissao: '2026-05-22', data_vencimento: '2026-07-21',
      valor_bruto: 174945, valor_liquido: 174945 })
    expect(p.proveniencia?.valor_bruto?.corroboratedBy).toContain('DUPLICATA_SUM')
    expect(p.proveniencia?.cnpj_emitente?.corroboratedBy).toContain('identificacao_emitente')
    expect(validarDanfeParaPersistencia(p)).toEqual({ ok: true })
    expect(extractDanfeFatura(fixture)).toEqual({ entries: [{ sequence: 1, due: '2026-07-21', cents: 17494500 }], cents: 17494500, due: '2026-07-21', reasons: [] })
  })

  it.each([
    ['modelo incompatível', KEY.slice(0, 20) + '65' + KEY.slice(22, 43)],
    ['UF inválida', '99' + KEY.slice(2, 43)],
    ['mês inválido', KEY.slice(0, 4) + '13' + KEY.slice(6, 43)],
  ])('rejeita %s mesmo com DV recalculado', (_name, body) => {
    const text = fixture.replace(KEY.match(/.{4}/g)!.join(' '), key(body))
    expect(validarDanfeParaPersistencia(extractDanfeFromText(text)).ok).toBe(false)
  })

  it('rejeita duas chaves fiscais válidas sem escolher silenciosamente uma delas', () => {
    const text = fixture + '\nCHAVE DE ACESSO ' + key(KEY.slice(0, 34) + '187654321')
    expect(validarDanfeParaPersistencia(extractDanfeFromText(text)).ok).toBe(false)
  })

  it('não usa CNPJ contido exclusivamente na chave como destinatário', () => {
    const text = fixture.replace('11.222.333/0001-81', KEY)
    expect(extractDanfeFromText(text).cnpj_destinatario).toBeUndefined()
    expect(validarDanfeParaPersistencia(extractDanfeFromText(text)).ok).toBe(false)
  })

  it('não aciona IA quando a camada textual é suficiente', async () => {
    const extractAi = vi.fn()
    const p = await extractDanfeFromPdf(Buffer.from('%PDF synthetic'), { extractNative: async () => ({ text: fixture }), extractAi })
    expect(extractAi).not.toHaveBeenCalled()
    expect(p.extraction_source).toBe('pdf_text_native')
    expect(validarDanfeParaPersistencia(p).ok).toBe(true)
  })

  it.each([
    ['DV inválido', fixture.replace(KEY.match(/.{4}/g)!.join(' '), KEY.slice(0, 43) + ((Number(KEY[43]) + 1) % 10))],
    ['emitente divergente', fixture.replace('12.345.678/0001-95', '98.765.432/0001-10')],
    ['emitente apenas na chave', fixture.replace('12.345.678/0001-95', '')],
    ['número divergente', fixture.replace('N. 056581', 'N. 056582')],
    ['série divergente', fixture.replace('SÉRIE 001', 'SÉRIE 002')],
    ['mês da chave divergente', fixture.replace('22/05/2026', '22/06/2026')],
    ['vencimento ausente', fixture.replace('21/07/2026', '')],
    ['vencimento impossível', fixture.replace('21/07/2026', '31/02/2026')],
    ['parcela ambígua', fixture.replace('01 - 21/07/2026 - Val:     174.945,00', '01 - 21/07/2026 - Val: 174.945,00\n01 - 22/07/2026 - Val: 174.945,00')],
    ['sequência incompleta', fixture.replace('01 - 21/07/2026', '02 - 21/07/2026')],
    ['valor divergente', fixture.replace('Val:     174.945,00', 'Val: 174.946,00')],
    ['fatura sem corroborador fiscal', fixture.slice(0, fixture.indexOf('CALCULO DO IMPOSTO'))],
  ])('rejeita %s', (_name, text) => {
    expect(validarDanfeParaPersistencia(extractDanfeFromText(text)).ok).toBe(false)
  })

  it('não coleta destinatário da chave, emitente ou transportador', () => {
    const noRecipient = fixture.replace('SACADO SINTETICO 11.222.333/0001-8122/05/2026', 'SACADO SINTETICO DATA DA EMISSAO 22/05/2026')
    const p = extractDanfeFromText(noRecipient)
    expect(p.cnpj_destinatario).toBeUndefined()
    expect(validarDanfeParaPersistencia(p).ok).toBe(false)
  })

  it('prioriza o destinatário fiscal sobre um banner de recebimento', () => {
    const p = extractDanfeFromText('DESTINATÁRIO: OUTRA EMPRESA SINTETICA\n' + fixture)
    expect(p.razao_social_destinatario).toBe('SACADO SINTETICO')
  })

  it('não inventa fatura a partir de produtos ou informações complementares', () => {
    const misplaced = fixture.replace('01 - 21/07/2026 - Val:     174.945,00', '') + '\n01 - 21/07/2026 - Val: 174.945,00'
    expect(extractDanfeFromText(misplaced).data_vencimento).toBeUndefined()
    expect(validarDanfeParaPersistencia(extractDanfeFromText(misplaced)).ok).toBe(false)
  })

  it('lê título vencido sem torná-lo válido na validação financeira existente', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T15:00:00Z'))
    try {
      const p = extractDanfeFromText(fixture)
      expect(p.data_vencimento).toBe('2026-07-21')
      const result = notaFiscalSchema.safeParse({ ...p, razao_social_emitente: 'EMITENTE SINTETICO' })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['data_vencimento'], message: 'Data de vencimento deve ser futura.' })]))
    } finally { vi.useRealTimers() }
  })
})
