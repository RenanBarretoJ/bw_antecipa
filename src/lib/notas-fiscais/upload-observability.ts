import { createHash, randomUUID } from 'node:crypto'
import type { UploadBatchResult, UploadFileStatus } from './upload-batch'

type FileEvent =
  | 'NF_UPLOAD_FILE_STARTED'
  | 'NF_UPLOAD_FILE_PARSED'
  | 'NF_UPLOAD_FILE_IMPORTED'
  | 'NF_UPLOAD_FILE_REJECTED_AMBIGUOUS'
  | 'NF_UPLOAD_FILE_REJECTED_INVALID'
  | 'NF_UPLOAD_FILE_DUPLICATE'
  | 'NF_UPLOAD_FILE_STORAGE_ERROR'
  | 'NF_UPLOAD_FILE_PERSISTENCE_ERROR'
  | 'NF_UPLOAD_FILE_COMPENSATED'

type SafeEvent = {
  event: FileEvent | 'NF_UPLOAD_BATCH_COMPLETED'
  correlation_id: string
  file_index?: number
  batch_size: number
  status?: UploadFileStatus
  layout_fingerprint?: string
  parse_strategy?: string
  confidence_bucket?: 'high' | 'medium' | 'low' | 'unknown'
  error_code?: string
  error_class?: 'validation' | 'duplicate' | 'storage' | 'persistence' | 'unknown'
  stage?: string
  retryable?: boolean
  duration_ms?: number
  imported_count?: number
  rejected_count?: number
  duplicate_count?: number
  storage_error_count?: number
  persistence_error_count?: number
  compensated_count?: number
}

type Sink = (event: SafeEvent) => void

const defaultSink: Sink = (event) => {
  if (event.event.endsWith('_ERROR')) console.error('[uploadNFs]', event)
  else if (event.event.includes('REJECTED') || event.event.includes('DUPLICATE')) console.warn('[uploadNFs]', event)
  else console.info('[uploadNFs]', event)
}

function opaque(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function logUploadStage(etapa: string): void {
  // Keep legacy diagnostic stages without serializing context or errors.
  const stage = /^[a-z_]{1,100}$/.test(etapa) ? etapa : 'unknown_stage'
  console.error('[uploadNFs][cedente]', { stage, error_code: 'UPLOAD_STAGE_FAILED', error_class: 'unknown', retryable: false })
}

export function createUploadTelemetry(batchSize: number, sink: Sink = defaultSink) {
  const correlationId = randomUUID()
  const startedAt = Date.now()
  const fileStarted = new Map<number, number>()
  const parsed = new Map<number, Pick<SafeEvent, 'layout_fingerprint' | 'parse_strategy' | 'confidence_bucket'>>()
  const compensated = new Set<number>()

  function emit(fileIndex: number, event: FileEvent, extra: Partial<SafeEvent> = {}) {
    sink({
      event,
      correlation_id: correlationId,
      file_index: fileIndex,
      batch_size: batchSize,
      ...parsed.get(fileIndex),
      ...extra,
      duration_ms: Math.max(0, Date.now() - (fileStarted.get(fileIndex) ?? startedAt)),
    })
  }

  return {
    correlationId,
    start(fileIndex: number) {
      fileStarted.set(fileIndex, Date.now())
      emit(fileIndex, 'NF_UPLOAD_FILE_STARTED')
    },
    parsed(fileIndex: number, details: { layoutFingerprint?: unknown; parseStrategy?: unknown; confidence?: unknown }) {
      const confidence = typeof details.confidence === 'number' && Number.isFinite(details.confidence) ? details.confidence : null
      parsed.set(fileIndex, {
        layout_fingerprint: opaque(details.layoutFingerprint),
        parse_strategy: opaque(details.parseStrategy),
        confidence_bucket: confidence === null ? 'unknown' : confidence >= 0.85 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
      })
      emit(fileIndex, 'NF_UPLOAD_FILE_PARSED')
    },
    compensated(fileIndex: number) {
      compensated.add(fileIndex)
      emit(fileIndex, 'NF_UPLOAD_FILE_COMPENSATED')
    },
    complete(batch: UploadBatchResult) {
      const events: Record<UploadFileStatus, FileEvent> = {
        IMPORTED: 'NF_UPLOAD_FILE_IMPORTED',
        REJECTED_AMBIGUOUS: 'NF_UPLOAD_FILE_REJECTED_AMBIGUOUS',
        REJECTED_INVALID: 'NF_UPLOAD_FILE_REJECTED_INVALID',
        DUPLICATE: 'NF_UPLOAD_FILE_DUPLICATE',
        STORAGE_ERROR: 'NF_UPLOAD_FILE_STORAGE_ERROR',
        PERSISTENCE_ERROR: 'NF_UPLOAD_FILE_PERSISTENCE_ERROR',
      }
      const classes: Record<Exclude<UploadFileStatus, 'IMPORTED'>, NonNullable<SafeEvent['error_class']>> = {
        REJECTED_AMBIGUOUS: 'validation',
        REJECTED_INVALID: 'validation',
        DUPLICATE: 'duplicate',
        STORAGE_ERROR: 'storage',
        PERSISTENCE_ERROR: 'persistence',
      }
      batch.results.forEach((result, index) => emit(index, events[result.status], {
        status: result.status,
        ...(result.status !== 'IMPORTED' ? {
          error_code: result.status,
          error_class: classes[result.status],
          stage: 'file_result',
          retryable: result.status === 'STORAGE_ERROR' || result.status === 'PERSISTENCE_ERROR',
        } : {}),
      }))
      sink({
        event: 'NF_UPLOAD_BATCH_COMPLETED',
        correlation_id: correlationId,
        batch_size: batch.total,
        imported_count: batch.successCount,
        rejected_count: batch.results.filter((result) => result.status.startsWith('REJECTED_')).length,
        duplicate_count: batch.results.filter((result) => result.status === 'DUPLICATE').length,
        storage_error_count: batch.results.filter((result) => result.status === 'STORAGE_ERROR').length,
        persistence_error_count: batch.results.filter((result) => result.status === 'PERSISTENCE_ERROR').length,
        compensated_count: compensated.size,
        duration_ms: Math.max(0, Date.now() - startedAt),
      })
    },
  }
}

export type UploadTelemetry = ReturnType<typeof createUploadTelemetry>
