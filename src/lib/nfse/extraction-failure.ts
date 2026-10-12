const failureCodes = [
  'NFSE_VISUAL_TIMEOUT', 'NFSE_VISUAL_DISABLED', 'NFSE_VISUAL_NOT_CONFIGURED',
  'NFSE_VISUAL_AUTH_FAILED', 'NFSE_VISUAL_UNAVAILABLE', 'NFSE_VISUAL_SIZE_INVALID',
  'NFSE_VISUAL_INVALID_RESPONSE', 'NFSE_VISUAL_CLASSIFICATION_AMBIGUOUS',
  'NFSE_VISUAL_INVALID_CONTRACT', 'NFSE_VISUAL_MUNICIPAL_CONTRACT_INVALID',
  'NFSE_VISUAL_MUNICIPAL_FINGERPRINT_INVALID', 'NFSE_VISUAL_LABEL_CONFLICT',
  'NFSE_VISUAL_INVALID_FIELD', 'NFSE_VISUAL_MUNICIPAL_FIELDS_MISSING',
  'NFSE_VISUAL_FISCAL_CONFLICT', 'NFSE_VISUAL_RETENTIONS_INVALID',
] as const
const visualStages = ['nfse_classification', 'nfse_municipal_extraction', 'nfse_national_extraction'] as const
type VisualStage = typeof visualStages[number]
type FailureCode = typeof failureCodes[number] | 'FISCAL_EXTRACTION_UNEXPECTED'

function safeCode(value: unknown): FailureCode {
  return failureCodes.find(code => code === value) ?? 'FISCAL_EXTRACTION_UNEXPECTED'
}

/** No cause, response body, document data or arbitrary error properties retained. */
export class NfseExtractionStageError extends Error {
  constructor(readonly stage: VisualStage, error: unknown, readonly durationMs: number) {
    super(safeCode(error instanceof Error ? error.message : undefined))
    this.name = 'NfseExtractionStageError'
  }
}

export async function runNfseVisualStage<T>(stage: VisualStage, operation: () => Promise<T>): Promise<T> {
  const startedAt = performance.now()
  try { return await operation() }
  catch (error) { throw new NfseExtractionStageError(stage, error, performance.now() - startedAt) }
}

/** Re-sanitize even typed errors at the log boundary. Never infer timeout from elapsed time. */
export function safeExtractionFailure(error: unknown) {
  const error_code = safeCode(error instanceof Error ? error.message : undefined)
  const stage = error instanceof NfseExtractionStageError
    ? visualStages.find(value => value === error.stage) ?? 'fiscal_parse' : 'fiscal_parse'
  const duration = error instanceof NfseExtractionStageError ? error.durationMs : undefined
  return {
    error_code, stage,
    retryable: error_code === 'NFSE_VISUAL_TIMEOUT' || error_code === 'NFSE_VISUAL_UNAVAILABLE',
    ...(typeof duration === 'number' && Number.isFinite(duration)
      ? { stage_duration_ms: Math.min(600_000, Math.max(0, Math.round(duration))) } : {}),
  }
}

export type SafeExtractionFailure = ReturnType<typeof safeExtractionFailure>

export function extractionFailureMessage(failure: SafeExtractionFailure): string {
  switch (failure.error_code) {
    case 'NFSE_VISUAL_TIMEOUT':
      return 'A leitura automática da NFS-e excedeu o tempo limite. A nota não foi importada nesta tentativa. Tente novamente em instantes.'
    case 'NFSE_VISUAL_DISABLED':
    case 'NFSE_VISUAL_NOT_CONFIGURED':
    case 'NFSE_VISUAL_AUTH_FAILED':
      return 'A leitura automática da NFS-e está indisponível por configuração do serviço. A nota não foi importada nesta tentativa. Contate o suporte.'
    case 'NFSE_VISUAL_UNAVAILABLE':
      return 'O serviço de leitura automática da NFS-e está temporariamente indisponível. A nota não foi importada nesta tentativa. Tente novamente em instantes.'
    case 'NFSE_VISUAL_INVALID_RESPONSE':
      return 'O serviço de leitura automática retornou uma resposta inválida. A nota não foi importada nesta tentativa. Contate o suporte se o problema persistir.'
    case 'FISCAL_EXTRACTION_UNEXPECTED':
      return 'Não foi possível concluir a leitura do documento. A nota não foi importada nesta tentativa. Contate o suporte.'
    default:
      return 'Não foi possível interpretar esta NFS-e com segurança. A nota não foi importada nesta tentativa. Confira o documento e contate o suporte.'
  }
}
