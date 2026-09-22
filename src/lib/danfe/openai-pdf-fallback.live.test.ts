import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { extractDanfeFromPdf, validarDanfeParaPersistencia } from '../pdf-nf-parser'

const liveEnabled = process.env.RUN_OPENAI_NF_LIVE_TEST === 'true'
  && Boolean(process.env.OPENAI_API_KEY)
  && Boolean(process.env.OPENAI_NF_LIVE_FIXTURE)

describe.runIf(liveEnabled)('fallback OpenAI real para DANFE PDF', () => {
  it('interpreta a fixture sem persistir dados ou acessar Storage', async () => {
    const buffer = await readFile(process.env.OPENAI_NF_LIVE_FIXTURE!)
    const extracted = await extractDanfeFromPdf(buffer, {
      extractNative: async () => ({ text: '' }),
      extractVisual: async () => { throw new Error('VISUAL_PDF_RENDER_FAILED') },
    })

    if (extracted.fallback_status !== 'success') {
      throw new Error(`OPENAI_NF_LIVE_FAILED:${(extracted.motivos_bloqueio || []).join(',')}`)
    }

    expect(extracted.extraction_source).toBe('pdf_ai_fallback')
    expect(extracted.fallback_status).toBe('success')
    expect(extracted.ai_extraction_confidence).toBeGreaterThanOrEqual(0.8)
    expect(validarDanfeParaPersistencia(extracted)).toEqual({ ok: true })
  }, 60_000)
})
