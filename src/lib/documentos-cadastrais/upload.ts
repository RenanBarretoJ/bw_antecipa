import type { DocumentoTipo } from '@/lib/types/domain'

export const DOCUMENTO_CADASTRAL_BUCKET = 'documentos-cedentes'
export const DOCUMENTO_CADASTRAL_MAX_BYTES = 20 * 1024 * 1024
export const DOCUMENTO_CADASTRAL_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const

type DocumentoRegistrado = {
  documento_id: string
  versao: number
  status: string
  storage_path: string
}

type StorageBucketClient = {
  upload(path: string, file: File): PromiseLike<{ error: { message: string } | null }>
  remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>
}

export type DocumentoCadastralUploadClient = {
  storage: {
    from(bucket: string): StorageBucketClient
  }
  rpc(
    fn: 'registrar_documento_cadastral_cedente',
    args: {
      p_tipo: DocumentoTipo
      p_storage_path: string
      p_nome_arquivo: string
      p_representante_id: string | null
    }
  ): PromiseLike<{ data: DocumentoRegistrado[] | DocumentoRegistrado | null; error: { message: string; code?: string } | null }>
}

export type ExecutarUploadDocumentoCadastralInput = {
  client: DocumentoCadastralUploadClient
  file: File
  tipo: DocumentoTipo
  storagePath: string
  representanteId: string | null
}

export type ExecutarUploadDocumentoCadastralResult =
  | { ok: true; documento: DocumentoRegistrado }
  | { ok: false; etapa: 'storage' | 'database'; message: string; compensationError?: string }

export function validarArquivoDocumentoCadastral(file: File): string | null {
  if (!DOCUMENTO_CADASTRAL_MIME_TYPES.includes(file.type as (typeof DOCUMENTO_CADASTRAL_MIME_TYPES)[number])) {
    return 'Formato invalido. Aceitos: PDF, JPG, PNG.'
  }
  if (file.size <= 0) return 'O arquivo esta vazio.'
  if (file.size > DOCUMENTO_CADASTRAL_MAX_BYTES) return 'Arquivo muito grande. Maximo: 20MB.'
  return null
}

export function criarCaminhoDocumentoCadastral(input: {
  cnpj: string
  tipo: DocumentoTipo
  nomeArquivo: string
  representanteId: string | null
  uploadId: string
}): string {
  const cleanName = input.nomeArquivo.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180) || 'documento'
  const subpasta = input.representanteId
    ? `representantes/${input.representanteId}`
    : input.tipo
  return `${input.cnpj}/${subpasta}/${input.uploadId}_${cleanName}`
}

export async function executarUploadDocumentoCadastral(
  input: ExecutarUploadDocumentoCadastralInput
): Promise<ExecutarUploadDocumentoCadastralResult> {
  const bucket = input.client.storage.from(DOCUMENTO_CADASTRAL_BUCKET)
  const { error: uploadError } = await bucket.upload(input.storagePath, input.file)

  if (uploadError) {
    return { ok: false, etapa: 'storage', message: uploadError.message }
  }

  const { data, error: databaseError } = await input.client.rpc('registrar_documento_cadastral_cedente', {
    p_tipo: input.tipo,
    p_storage_path: input.storagePath,
    p_nome_arquivo: input.file.name,
    p_representante_id: input.representanteId,
  })

  if (databaseError) {
    const { error: compensationError } = await bucket.remove([input.storagePath])
    return {
      ok: false,
      etapa: 'database',
      message: databaseError.message,
      compensationError: compensationError?.message,
    }
  }

  const documento = Array.isArray(data) ? data[0] : data
  if (!documento) {
    const { error: compensationError } = await bucket.remove([input.storagePath])
    return {
      ok: false,
      etapa: 'database',
      message: 'O banco nao retornou o documento registrado.',
      compensationError: compensationError?.message,
    }
  }

  return { ok: true, documento }
}
