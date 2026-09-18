export type UploadFileStatus =
  | 'IMPORTED'
  | 'REJECTED_AMBIGUOUS'
  | 'REJECTED_INVALID'
  | 'DUPLICATE'
  | 'STORAGE_ERROR'
  | 'PERSISTENCE_ERROR'

export type UploadFileResult =
  | { fileName: string; status: 'IMPORTED'; nfId: string; nfNumero?: string }
  | { fileName: string; status: Exclude<UploadFileStatus, 'IMPORTED'>; message: string }

export type UploadBatchResult = {
  total: number
  successCount: number
  errorCount: number
  results: UploadFileResult[]
}

export type ProcessedUploadFile =
  | { ok: true; id: string; isRascunho: boolean; nfNumero?: string }
  | { ok: false; status: Exclude<UploadFileStatus, 'IMPORTED'>; error: string }

export function resumirUploadBatch(results: UploadFileResult[]): UploadBatchResult {
  const successCount = results.filter((result) => result.status === 'IMPORTED').length
  return {
    total: results.length,
    successCount,
    errorCount: results.length - successCount,
    results,
  }
}

export function arquivosPendentesDeRetry<T>(files: readonly T[], batch: UploadBatchResult): T[] {
  return files.filter((_, index) => batch.results[index]?.status !== 'IMPORTED')
}

export async function executarUploadPorArquivo<T extends { name: string }>(
  files: readonly T[],
  processar: (file: T) => Promise<ProcessedUploadFile>,
  onUnexpectedError?: (error: unknown) => void,
) {
  const settled = await Promise.allSettled(files.map(processar))
  const ids: string[] = []
  const rascunhos: string[] = []
  const results: UploadFileResult[] = settled.map((result, index) => {
    const fileName = files[index].name
    if (result.status === 'rejected') {
      onUnexpectedError?.(result.reason)
      return { fileName, status: 'PERSISTENCE_ERROR', message: 'Não foi possível concluir este arquivo. Verifique a NF antes de reenviar.' }
    }
    if (!result.value.ok) {
      return { fileName, status: result.value.status, message: result.value.error }
    }
    ids.push(result.value.id)
    if (result.value.isRascunho) rascunhos.push(result.value.id)
    return { fileName, status: 'IMPORTED', nfId: result.value.id, nfNumero: result.value.nfNumero }
  })

  return { batch: resumirUploadBatch(results), ids, rascunhos }
}
