import { readFileSync } from 'node:fs'
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

describe('fallback OpenAI do parser PDF', () => {
  it('preserva o caminho nativo e nao chama a API quando o texto e utilizavel', async () => {
    const extractAi = vi.fn()
    const result = await extractDanfeFromPdf(Buffer.from('pdf'), {
      extractNative: async () => ({ text: validDanfeText() }),
      extractAi,
    })
    expect(extractAi).not.toHaveBeenCalled()
    expect(result.extraction_source).toBe('pdf_text_native')
    expect(result.native_text_length_bucket).toBe('medium')
    expect(validarDanfeParaPersistencia(result)).toEqual({ ok: true })
  })

  it('envia o PDF sem texto diretamente para a API e conserva os gates P12', async () => {
    const extractAi = vi.fn(async (_buffer: Buffer, reason: 'NO_TEXT_LAYER' | 'TEXT_INSUFFICIENT' | 'MISSING_CORE_ANCHORS' | 'NATIVE_EXTRACTION_FAILED') => ({
      text: validDanfeText(),
      confidence: 0.94,
      durationMs: 2310,
      fallbackTriggerReason: reason,
    }))
    const result = await extractDanfeFromPdf(Buffer.from('pdf'), {
      extractNative: async () => ({ text: '' }),
      extractAi,
    })
    expect(extractAi).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      numero_nf: '154806',
      cnpj_emitente: EMITENTE,
      cnpj_destinatario: DESTINATARIO,
      data_emissao: '2026-09-16',
      valor_bruto: 8371.99,
      extraction_source: 'pdf_ai_fallback',
      native_text_length_bucket: 'empty',
      fallback_trigger_reason: 'NO_TEXT_LAYER',
      fallback_status: 'success',
      fallback_duration_ms: 2310,
      ai_extraction_confidence: 0.94,
    })
    expect(validarDanfeParaPersistencia(result)).toEqual({ ok: true })
  })

  it('tambem usa a API quando a camada textual existe mas nao tem ancoras fiscais', async () => {
    const extractAi = vi.fn(async (_buffer: Buffer, reason: 'NO_TEXT_LAYER' | 'TEXT_INSUFFICIENT' | 'MISSING_CORE_ANCHORS' | 'NATIVE_EXTRACTION_FAILED') => ({
      text: validDanfeText(),
      confidence: 0.91,
      durationMs: 500,
      fallbackTriggerReason: reason,
    }))
    const result = await extractDanfeFromPdf(Buffer.from('pdf'), {
      extractNative: async () => ({ text: 'documento sem campos fiscais suficientes '.repeat(5) }),
      extractAi,
    })
    expect(result.fallback_trigger_reason).toBe('MISSING_CORE_ANCHORS')
    expect(result.extraction_source).toBe('pdf_ai_fallback')
    expect(validarDanfeParaPersistencia(result)).toEqual({ ok: true })
  })

  it('falha fechado quando a resposta da API nao atravessa o gate fiscal', async () => {
    const result = await extractDanfeFromPdf(Buffer.from('pdf'), {
      extractNative: async () => ({ text: '' }),
      extractAi: async (_buffer, reason) => ({
        text: 'CHAVE DE ACESSO 29260912345678000195550020001548061123456780',
        confidence: 0.99,
        durationMs: 500,
        fallbackTriggerReason: reason,
      }),
    })
    expect(result).toMatchObject({ extraction_source: 'pdf_ai_fallback', fallback_status: 'failed' })
    expect(result.motivos_bloqueio).toContain('openai_nf_fiscal_validation_failed')
    expect(validarDanfeParaPersistencia(result).ok).toBe(false)
  })

  it('nao propaga texto de erro da API para observabilidade ou resposta', async () => {
    const result = await extractDanfeFromPdf(Buffer.from('pdf'), {
      extractNative: async () => { throw new Error('native secret') },
      extractAi: async () => { throw new Error('Bearer outro-segredo') },
    })
    expect(result.fallback_status).toBe('failed')
    expect(result.motivos_bloqueio).toEqual([
      'pdf_text_extraction_failed',
      'openai_nf_request_failed',
    ])
    expect(JSON.stringify(result)).not.toContain('outro-segredo')
    expect(validarDanfeParaPersistencia(result).ok).toBe(false)
  })

  it('nao reintroduz renderizacao ou OCR local no caminho de PDF', () => {
    const source = readFileSync('src/lib/pdf-nf-parser.ts', 'utf8')
    expect(source).not.toContain('pdf-visual-fallback')
    expect(source).not.toContain('extractVisual')
    expect(source).toContain('openai-pdf-fallback.server')
  })
})
