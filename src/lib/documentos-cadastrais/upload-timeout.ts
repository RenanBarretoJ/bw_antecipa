export type FaseUpload = 'PREPARE' | 'UPLOAD' | 'FINALIZE' | 'RECONCILE' | 'CLEANUP'

export class UploadTimeoutError extends Error {
  constructor(readonly phase: FaseUpload) {
    super('UPLOAD_TIMEOUT')
    this.name = 'UploadTimeoutError'
  }
}

export async function aguardarUploadComPrazo<T>(operation: Promise<T>, milliseconds: number, phase: FaseUpload = 'UPLOAD', correlationId?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const startedAt = Date.now()
  let outcome = 'success'
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new UploadTimeoutError(phase)), milliseconds)
      }),
    ])
  } catch (error) {
    outcome = error instanceof UploadTimeoutError ? `${phase}_TIMEOUT` : 'NETWORK_FAILURE'
    throw error
  } finally {
    if (timer) clearTimeout(timer)
    if (correlationId) console.info('document-upload-phase', {
      phase, correlationId, startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt, outcome,
    })
  }
}
