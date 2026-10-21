import { describe, expect, it, vi } from 'vitest'
import { extractDanfeFromPdf, extractDanfeFromText, validarDanfeParaPersistencia, validarDanfeParaVinculo } from '../pdf-nf-parser'
import { extractDanfeFatura } from './fatura'

function fiscalKey(numero: number, month = '09', issuer = '12345678000195'): string {
  const body = `2926${month}${issuer}55002${String(numero).padStart(9, '0')}112345678`
  let sum = 0
  for (let i = 42, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(body[i]) * weight
  const mod = sum % 11
  return body + (mod < 2 ? 0 : 11 - mod)
}

const KEY = fiscalKey(444321)
const REF = fiscalKey(444111, '08')
// Synthetic text order and concatenation only. No private PDF or clinical data.
const fixture = [
  'IDENTIFICAÇÃO DO EMITENTE', 'DANFE', 'DOCUMENTO', 'CHAVE DE ACESSO',
  '0-ENTRADA', '1-SAÍDA', KEY.match(/.{4}/g)!.join(' '),
  'INSCRIÇÃO ESTADUAL DO SUBST. TRIBUT.INSCRIÇÃO ESTADUALCNPJ/CPF',
  '123.456.78912.345.678/0001-95', 'ELETRÔNICA', 'AUXILIAR DA',
  'Nº 444.321', 'SÉRIE 2', 'NATUREZA DA OPERAÇÃO', 'VENDA DE PRODUTOS',
  'DESTINATÁRIO', 'NOME / RAZÃO SOCIALCNPJ/CPFDATA DA EMISSÃO',
  'SACADO SINTETICO11.222.333/0001-8104/09/2026',
  'FATURA / DUPLICATA', 'FORMA DE PAGAMENTO', 'PAGAMENTO A PRAZO',
  'PARCELAS', '444321/00103/11/20262.345,67', 'CÁLCULO DO IMPOSTO',
  'VLR PIS', '15,25', 'VLR COFINS', '70,37', 'VALOR IBS', '0,94', 'VALOR CBS', '8,21',
  'VLR APROX TRIB', '410,00', 'TOTAL DA NOTA', '2.345,67',
  'TRANSPORTADOR / VOLUMES TRANSPORTADOS', 'OUTRA EMPRESA 98.765.432/0001-10',
  'DADOS DOS PRODUTOS / SERVIÇOS', 'PRODUTO SINTETICO',
  'DADOS ADICIONAIS', 'INFORMAÇÕES COMPLEMENTARES', `NF-e REF: ${REF}`,
  'RECEBEMOS DE EMITENTE SINTETICO LTDA',
  'EMISSÃO: 04-09-2026 - VALOR TOTAL: R$ 2.345,67',
].join('\n')

describe('DANFE: primary key versus explicit reference and inline installments', () => {
  it('reads the fiscal body without confusing an explicit reference or concatenated cells', () => {
    const p = extractDanfeFromText(fixture)
    expect(p).toMatchObject({ tipo_reconhecido: 'DANFE', numero_nf: '444321', serie: '2', chave_acesso: KEY,
      cnpj_emitente: '12345678000195', cnpj_destinatario: '11222333000181', razao_social_destinatario: 'SACADO SINTETICO',
      data_emissao: '2026-09-04', data_vencimento: '2026-11-03', valor_bruto: 2345.67, valor_liquido: 2345.67 })
    expect(p.motivos_bloqueio).toEqual([])
    expect(validarDanfeParaPersistencia(p)).toEqual({ ok: true })
    expect(validarDanfeParaVinculo(p)).toBe(true)
    expect(extractDanfeFatura(fixture)).toMatchObject({ invoiceNumber: '444321', entries: [{ sequence: 1, due: '2026-11-03', cents: 234567 }], cents: 234567, due: '2026-11-03', reasons: [] })
  })

  it('uses the labeled primary key even if an explicit reference appears first', () => {
    const p = extractDanfeFromText(`NF-e REF: ${REF}\n${fixture}`)
    expect(p.chave_acesso).toBe(KEY)
    expect(validarDanfeParaPersistencia(p)).toEqual({ ok: true })
  })

  it.each([
    ['two header keys', fixture.replace('Nº 444.321', `CHAVE DE ACESSO\n${REF}\nNº 444.321`)],
    ['unlabeled second key', fixture.replace('NF-e REF:', 'OUTRA CHAVE:')],
    ['no primary anchor', fixture.replace('CHAVE DE ACESSO', 'CÓDIGO')],
    ['header invoice mismatch', fixture.replace('Nº 444.321', 'Nº 444.322')],
    ['header series mismatch', fixture.replace('SÉRIE 2', 'SÉRIE 3')],
    ['header issuer mismatch', fixture.replace('12.345.678/0001-95', '98.765.432/0001-10')],
    ['issuer only in barcode', fixture.replace('12.345.678/0001-95', '')],
    ['footer issuer cannot fill missing header', fixture.replace('12.345.678/0001-95', '') + '\nRECEBEMOS DE EMITENTE SINTETICO 12.345.678/0001-95'],
    ['date inconsistent with key', fixture.replaceAll('04/09/2026', '04/10/2026')],
    ['missing recipient', fixture.replace('11.222.333/0001-81', '')],
    ['two recipient identities', fixture.replace('FATURA / DUPLICATA', 'OUTRO SACADO 98.765.432/0001-10\nFATURA / DUPLICATA')],
    ['invoice number in installment mismatch', fixture.replace('444321/001', '444322/001')],
    ['invalid calendar', fixture.replace('03/11/2026', '31/02/2026')],
    ['incomplete sequence', fixture.replace('444321/001', '444321/002')],
    ['duplicate installment', fixture.replace('CÁLCULO DO IMPOSTO', '444321/00103/11/20262.345,67\nCÁLCULO DO IMPOSTO')],
    ['installment amount mismatch', fixture.replace('444321/00103/11/20262.345,67', '444321/00103/11/20262.346,67')],
    ['invalid primary DV', fixture.replace(KEY.match(/.{4}/g)!.join(' '), KEY.slice(0, 43) + ((Number(KEY[43]) + 1) % 10))],
  ])('fails closed: %s', (_name, text) => {
    const p = extractDanfeFromText(text)
    expect(validarDanfeParaPersistencia(p).ok).toBe(false)
  })

  it('reads a complete multiline installment schedule with exact cents', () => {
    const p = extractDanfeFromText(fixture.replace('444321/00103/11/20262.345,67', '444321/001 03/11/2026 1.000,00\n444321/002 03/12/2026 1.345,67'))
    expect(p.data_vencimento).toBe('2026-12-03')
    expect(p.valor_bruto).toBe(2345.67)
    expect(validarDanfeParaPersistencia(p)).toEqual({ ok: true })
  })

  it('tax disclosure is not a retention or a financial deduction', () => {
    const p = extractDanfeFromText(fixture.replace('410,00', '9.999,99'))
    expect(Math.round(p.valor_bruto! * 100)).toBe(234567)
    expect(Math.round(p.valor_liquido! * 100)).toBe(234567)
    expect(validarDanfeParaPersistencia(p)).toEqual({ ok: true })
  })

  it('native readable text does not trigger external visual extraction', async () => {
    const extractAi = vi.fn()
    const p = await extractDanfeFromPdf(Buffer.from('%PDF synthetic'), { extractNative: async () => ({ text: fixture }), extractAi })
    expect(extractAi).not.toHaveBeenCalled()
    expect(p.extraction_source).toBe('pdf_text_native')
    expect(validarDanfeParaPersistencia(p)).toEqual({ ok: true })
  })
})
