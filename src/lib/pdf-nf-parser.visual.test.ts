import { describe, expect, it, vi } from 'vitest'
import { extractDanfeFromPdf, validarDanfeParaPersistencia } from './pdf-nf-parser'

const EMITENTE = '12345678000195'
const DESTINATARIO = '11222333000181'

function keyFor(numero: number, serie = 2, yearMonth = '2609'): string {
  const body = `29${yearMonth}${EMITENTE}55${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}112345678`
  let sum = 0
  let weight = 2
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(body[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const remainder = sum % 11
  return body + (remainder < 2 ? 0 : 11 - remainder)
}

function validDanfeText(numero = 154806, issue = '16/09/2026'): string {
  return [
    'IDENTIFICACAO DO EMITENTE',
    `CNPJ ${EMITENTE}`,
    `CHAVE DE ACESSO ${keyFor(numero)}`,
    'DESTINATARIO / REMETENTE',
    `CNPJ ${DESTINATARIO}`,
    `DATA DE EMISSAO ${issue}`,
    'VENCIMENTO 31/10/2026',
    'VALOR TOTAL DA NOTA R$ 8.371,99',
    `${numero}-01/01 31/10/2026 8371.99 |`,
  ].join('\n')
}

describe('fallback visual do parser PDF', () => {
  it('preserva o caminho nativo e nao chama OCR quando o texto e utilizavel', async () => {
    const extractVisual = vi.fn()
    const result = await extractDanfeFromPdf(Buffer.from('pdf'), {
      extractNative: async () => ({ text: validDanfeText() }),
      extractVisual,
    })
    expect(extractVisual).not.toHaveBeenCalled()
    expect(result.extraction_source).toBe('pdf_text_native')
    expect(result.native_text_length_bucket).toBe('medium')
    expect(validarDanfeParaPersistencia(result)).toEqual({ ok: true })
  })

  it('aciona o fallback somente sem texto util e reutiliza o parser P12', async () => {
    const extractVisual = vi.fn(async (_buffer: Buffer, reason: 'NO_TEXT_LAYER' | 'TEXT_INSUFFICIENT' | 'MISSING_CORE_ANCHORS' | 'NATIVE_EXTRACTION_FAILED') => ({
      text: validDanfeText(),
      ocrConfidence: 78.4,
      durationMs: 4321,
      fallbackTriggerReason: reason,
    }))
    const result = await extractDanfeFromPdf(Buffer.from('pdf'), {
      extractNative: async () => ({ text: '\n\n' }),
      extractVisual,
    })
    expect(extractVisual).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      numero_nf: '154806',
      cnpj_emitente: EMITENTE,
      cnpj_destinatario: DESTINATARIO,
      data_emissao: '2026-09-16',
      valor_bruto: 8371.99,
      extraction_source: 'pdf_visual_fallback',
      native_text_length_bucket: 'empty',
      fallback_trigger_reason: 'NO_TEXT_LAYER',
      fallback_status: 'success',
      fallback_duration_ms: 4321,
      visual_ocr_confidence: 78.4,
    })
    expect(result.confianca?.valor_bruto).toBeLessThanOrEqual(0.9)
    expect(validarDanfeParaPersistencia(result)).toEqual({ ok: true })
  })

  it('falha fechado quando a data visual conflita com o ano-mes da chave', async () => {
    const result = await extractDanfeFromPdf(Buffer.from('pdf'), {
      extractNative: async () => ({ text: '' }),
      extractVisual: async (_buffer, reason) => ({
        text: validDanfeText(154806, '16/08/2026'),
        ocrConfidence: 90,
        durationMs: 100,
        fallbackTriggerReason: reason,
      }),
    })
    expect(result.motivos_bloqueio).toContain('issue_date_key_conflict')
    expect(validarDanfeParaPersistencia(result).ok).toBe(false)
  })

  it('falha fechado quando o fallback visual nao valida uma chave de acesso', async () => {
    const result = await extractDanfeFromPdf(Buffer.from('pdf'), {
      extractNative: async () => ({ text: '' }),
      extractVisual: async (_buffer, reason) => ({
        text: [
          `CNPJ ${EMITENTE}`,
          'NF 154806 SERIE 2',
          'DATA DE EMISSAO 16/09/2026',
          'VALOR TOTAL DA NOTA R$ 8.371,99',
        ].join('\n'),
        ocrConfidence: 90,
        durationMs: 100,
        fallbackTriggerReason: reason,
      }),
    })
    expect(result.motivos_bloqueio).toContain('visual_access_key_missing')
    expect(validarDanfeParaPersistencia(result).ok).toBe(false)
  })

  it('nao propaga texto de erro do fallback para observabilidade ou resposta', async () => {
    const result = await extractDanfeFromPdf(Buffer.from('pdf'), {
      extractNative: async () => { throw new Error('native secret') },
      extractVisual: async () => { throw new Error('CNPJ 12.345.678/0001-95 token secreto') },
    })
    expect(result.fallback_status).toBe('failed')
    expect(result.motivos_bloqueio).toEqual(['pdf_text_extraction_failed', 'visual_pdf_fallback_failed'])
    expect(JSON.stringify(result)).not.toContain('token secreto')
    expect(validarDanfeParaPersistencia(result).ok).toBe(false)
  })
})
