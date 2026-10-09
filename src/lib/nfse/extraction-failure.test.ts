import { afterEach, describe, expect, it, vi } from 'vitest'
import { NfseExtractionStageError, runNfseVisualStage, safeExtractionFailure, extractionFailureMessage } from './extraction-failure'
import { probeNfsePdf } from './pdf-dispatcher.server'
import { classifyFiscalImage } from './openai-visual.server'
import { municipalFixture } from './fixtures/municipal'
import { validateMunicipalVisual } from './municipal-visual-contract'

afterEach(() => vi.useRealTimers())
const native = async () => ({ text: 'NOTA FISCAL ELETRONICA DE SERVICOS MUNICIPAL '.repeat(3) })
const bytes = Buffer.from('%PDF-synthetic')

describe('extraction failure diagnostics', () => {
  it.each([
    ['NFSE_VISUAL_TIMEOUT', true, 'tempo limite'],
    ['NFSE_VISUAL_UNAVAILABLE', true, 'temporariamente indisponível'],
    ['NFSE_VISUAL_NOT_CONFIGURED', false, 'configuração'],
    ['NFSE_VISUAL_AUTH_FAILED', false, 'configuração'],
    ['NFSE_VISUAL_DISABLED', false, 'configuração'],
    ['NFSE_VISUAL_INVALID_RESPONSE', false, 'resposta inválida'],
    ['NFSE_VISUAL_MUNICIPAL_CONTRACT_INVALID', false, 'com segurança'],
    ['NFSE_VISUAL_MUNICIPAL_FINGERPRINT_INVALID', false, 'com segurança'],
    ['NFSE_VISUAL_MUNICIPAL_FIELDS_MISSING', false, 'com segurança'],
    ['NFSE_VISUAL_INVALID_CONTRACT', false, 'com segurança'],
    ['NFSE_VISUAL_LABEL_CONFLICT', false, 'com segurança'],
    ['NFSE_VISUAL_INVALID_FIELD', false, 'com segurança'],
    ['NFSE_VISUAL_FISCAL_CONFLICT', false, 'com segurança'],
    ['NFSE_VISUAL_RETENTIONS_INVALID', false, 'com segurança'],
    ['NFSE_VISUAL_SIZE_INVALID', false, 'com segurança'],
    ['NFSE_VISUAL_CLASSIFICATION_AMBIGUOUS', false, 'com segurança'],
  ] as const)('retains only the known code %s and a static message', (code, retryable, message) => {
    const error = new NfseExtractionStageError('nfse_municipal_extraction', new Error(code), 1234.2)
    const safe = safeExtractionFailure(error)
    expect(safe).toEqual({ error_code: code, stage: 'nfse_municipal_extraction', retryable, stage_duration_ms: 1234 })
    expect(extractionFailureMessage(safe)).toContain(message)
    expect(extractionFailureMessage(safe)).not.toContain(code)
    expect(error).not.toHaveProperty('cause')
  })

  it.each([new Error('NFSE_VISUAL_TIMEOUT Bearer secret'), new Error('NFSE_VISUAL_SECRET_VALUE'),
    { message: 'NFSE_VISUAL_TIMEOUT', token: 'secret' }, null])('does not accept arbitrary errors or infer timeout by duration', error => {
    const wrapped = new NfseExtractionStageError('nfse_classification', error, 33404)
    expect(safeExtractionFailure(wrapped)).toMatchObject({ error_code: 'FISCAL_EXTRACTION_UNEXPECTED', retryable: false })
    expect(extractionFailureMessage(safeExtractionFailure(wrapped))).not.toContain('tempo limite')
    expect(JSON.stringify(wrapped)).not.toContain('secret')
  })

  it('re-sanitizes tampering and excludes arbitrary properties at the log boundary', () => {
    const error = new NfseExtractionStageError('nfse_classification', new Error('NFSE_VISUAL_TIMEOUT'), 1)
    Object.assign(error, { message: 'NFSE_VISUAL_SECRET_VALUE', stage: 'Bearer secret', durationMs: Infinity, response: 'private body' })
    expect(safeExtractionFailure(error)).toEqual({ error_code: 'FISCAL_EXTRACTION_UNEXPECTED', stage: 'fiscal_parse', retryable: false })
  })

  it('keeps classification failure separate and never invokes extractors after it', async () => {
    const municipal = vi.fn(), visual = vi.fn()
    const result = await probeNfsePdf(bytes, { native, municipal, visual,
      classify: async () => { throw new Error('NFSE_VISUAL_TIMEOUT') },
    }).catch(error => error)
    expect(result).toBeInstanceOf(NfseExtractionStageError)
    expect(safeExtractionFailure(result)).toMatchObject({ stage: 'nfse_classification', error_code: 'NFSE_VISUAL_TIMEOUT' })
    expect(municipal).not.toHaveBeenCalled(); expect(visual).not.toHaveBeenCalled()
  })

  it.each(['nfse_municipal', 'nfse_danfse_v2'] as const)('identifies %s extraction failure without another fallback', async kind => {
    const fail = vi.fn(async () => { throw new Error('NFSE_VISUAL_INVALID_RESPONSE') })
    const other = vi.fn()
    const result = await probeNfsePdf(bytes, { native, classify: async () => kind,
      municipal: kind === 'nfse_municipal' ? fail : other,
      visual: kind === 'nfse_danfse_v2' ? fail : other,
    }).catch(error => error)
    expect(safeExtractionFailure(result)).toMatchObject({
      stage: kind === 'nfse_municipal' ? 'nfse_municipal_extraction' : 'nfse_national_extraction',
      error_code: 'NFSE_VISUAL_INVALID_RESPONSE',
    })
    expect(fail).toHaveBeenCalledOnce(); expect(other).not.toHaveBeenCalled()
  })

  it('preserves the exact successful extraction and native DANFE delegation', async () => {
    const extraction = validateMunicipalVisual(municipalFixture())
    expect(await probeNfsePdf(bytes, { native, classify: async () => 'nfse_municipal', municipal: async () => extraction })).toBe(extraction)
    const classify = vi.fn()
    expect(await probeNfsePdf(bytes, { native: async () => ({ text: 'DANFE NOTA FISCAL ELETRONICA '.repeat(4) }), classify })).toBeNull()
    expect(classify).not.toHaveBeenCalled()
  })

  it('preserves rejection when a plausible NFS-e is classified as DANFE', async () => {
    const municipal = vi.fn(), visual = vi.fn()
    const error = await probeNfsePdf(bytes, { native, classify: async () => 'nfe_danfe', municipal, visual }).catch(error => error)
    expect(safeExtractionFailure(error)).toMatchObject({ error_code: 'NFSE_VISUAL_CLASSIFICATION_AMBIGUOUS', stage: 'nfse_classification' })
    expect(municipal).not.toHaveBeenCalled(); expect(visual).not.toHaveBeenCalled()
  })

  it('reports the existing provider abort timeout without changing its deadline', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('private response', 'AbortError')), { once: true })
    }))
    const pending = runNfseVisualStage('nfse_classification', () => classifyFiscalImage(bytes, {
      env: { OPENAI_API_KEY: 'synthetic' }, timeoutMs: 5000, fetchImpl,
    })).catch(error => safeExtractionFailure(error))
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toMatchObject({ error_code: 'NFSE_VISUAL_TIMEOUT', stage: 'nfse_classification', retryable: true })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
