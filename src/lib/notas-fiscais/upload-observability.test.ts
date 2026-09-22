import { describe, expect, it, vi } from 'vitest'
import { createUploadTelemetry, logUploadStage } from './upload-observability'
import { resumirUploadBatch, type UploadFileResult } from './upload-batch'

const sensitive = [
  '35260907312248000137550010000017411000017419',
  '07312248000137',
  '12345678909',
  'Banco 123 agencia 4567 conta 987654',
  'NOME PACIENTE CONFIDENCIAL',
  'https://storage.example/signed?token=secreto',
  'Bearer token-secreto',
  'service_role=secreto',
  'Error: stack trace at source:12',
  'violates constraint notas_fiscais_chave_acesso_key',
]

describe('upload NF observability', () => {
  it('emits success for MK, BAHIAMED and generic DANFE with one batch correlation', () => {
    const events: Record<string, unknown>[] = []
    const telemetry = createUploadTelemetry(3, (event) => events.push(event))
    const layouts = ['mk', 'bahiamed', 'generic_danfe']
    layouts.forEach((layout, index) => {
      telemetry.start(index)
      telemetry.parsed(index, { layoutFingerprint: layout, parseStrategy: layout, confidence: 0.95 })
    })
    telemetry.complete(resumirUploadBatch(layouts.map((_, index) => ({ fileName: `synthetic-${index}.pdf`, status: 'IMPORTED', nfId: `${index}` }))))
    expect(events.filter((event) => event.event === 'NF_UPLOAD_FILE_IMPORTED')).toHaveLength(3)
    expect(events.filter((event) => event.event === 'NF_UPLOAD_FILE_PARSED')).toHaveLength(3)
    expect(events.at(-1)).toMatchObject({ event: 'NF_UPLOAD_BATCH_COMPLETED', imported_count: 3, rejected_count: 0, compensated_count: 0 })
    expect(new Set(events.map((event) => event.correlation_id))).toEqual(new Set([telemetry.correlationId]))
    expect(JSON.stringify(events)).not.toContain('synthetic-')
  })

  it('counts ambiguous, duplicate, storage and persistence outcomes with compensation', () => {
    const events: Record<string, unknown>[] = []
    const telemetry = createUploadTelemetry(5, (event) => events.push(event))
    const results: UploadFileResult[] = [
      { fileName: 'ok.pdf', status: 'IMPORTED', nfId: '1' },
      { fileName: 'ambiguous.pdf', status: 'REJECTED_AMBIGUOUS', message: sensitive.join(' ') },
      { fileName: 'duplicate.pdf', status: 'DUPLICATE', message: sensitive.join(' ') },
      { fileName: 'storage.pdf', status: 'STORAGE_ERROR', message: sensitive.join(' ') },
      { fileName: 'persistence.pdf', status: 'PERSISTENCE_ERROR', message: sensitive.join(' ') },
    ]
    results.forEach((_, index) => telemetry.start(index))
    telemetry.parsed(1, { layoutFingerprint: sensitive.join(' '), parseStrategy: sensitive.join(' '), confidence: 0.2 })
    telemetry.compensated(4)
    telemetry.complete(resumirUploadBatch(results))
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining([
      'NF_UPLOAD_FILE_REJECTED_AMBIGUOUS', 'NF_UPLOAD_FILE_DUPLICATE',
      'NF_UPLOAD_FILE_STORAGE_ERROR', 'NF_UPLOAD_FILE_PERSISTENCE_ERROR', 'NF_UPLOAD_FILE_COMPENSATED',
    ]))
    expect(events.at(-1)).toMatchObject({
      event: 'NF_UPLOAD_BATCH_COMPLETED', batch_size: 5, imported_count: 1,
      rejected_count: 1, duplicate_count: 1, storage_error_count: 1,
      persistence_error_count: 1, compensated_count: 1,
    })
    const output = JSON.stringify(events)
    for (const secret of sensitive) expect(output).not.toContain(secret)
    expect(new Set(events.map((event) => event.correlation_id))).toEqual(new Set([telemetry.correlationId]))
  })

  it('registra o fallback de IA apenas em buckets, sem conteudo fiscal', () => {
    const events: Record<string, unknown>[] = []
    const telemetry = createUploadTelemetry(1, (event) => events.push(event))
    telemetry.start(0)
    telemetry.parsed(0, {
      layoutFingerprint: sensitive.join(' '),
      parseStrategy: sensitive.join(' '),
      confidence: 0.9,
      extractionSource: 'pdf_ai_fallback',
      nativeTextLengthBucket: 'empty',
      fallbackTriggerReason: 'NO_TEXT_LAYER',
      fallbackStatus: 'success',
      fallbackDurationMs: 2310,
      aiExtractionConfidence: 0.94,
    })
    expect(events.find((event) => event.event === 'NF_UPLOAD_FILE_PARSED')).toMatchObject({
      extraction_source: 'pdf_ai_fallback',
      ai_extraction_confidence_bucket: 'high',
    })
    const output = JSON.stringify(events)
    for (const secret of sensitive) expect(output).not.toContain(secret)
  })

  it('never serializes raw context or error in legacy stage diagnostics', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      logUploadStage(`insert_nf_erro_${sensitive.join(' ')}`)
      const output = JSON.stringify(spy.mock.calls)
      expect(output).toContain('UPLOAD_STAGE_FAILED')
      for (const secret of sensitive) expect(output).not.toContain(secret)
    } finally {
      spy.mockRestore()
    }
  })
})
