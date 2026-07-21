import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { DOCUMENTO_V2_BUCKET, nomeSeguro } from './tipos'

export function gerarCaminhoDocumento({
  cedenteId,
  notaFiscalId,
  tipoCodigo,
  nomeOriginal,
}: {
  cedenteId: string
  notaFiscalId: string
  tipoCodigo: string
  nomeOriginal: string
}): string {
  const ext = nomeOriginal.includes('.') ? nomeOriginal.slice(nomeOriginal.lastIndexOf('.')).toLowerCase() : ''
  return `${cedenteId}/nota-fiscal/${notaFiscalId}/${tipoCodigo}/${randomUUID()}${ext}`
}

export function gerarCaminhoDocumentoLogistico({
  cedenteId,
  contextoTipo,
  contextoId,
  tipoCodigo,
  nomeOriginal,
}: {
  cedenteId: string
  contextoTipo: 'cte' | 'entrega'
  contextoId: string
  tipoCodigo: string
  nomeOriginal: string
}): string {
  const ext = nomeOriginal.includes('.') ? nomeOriginal.slice(nomeOriginal.lastIndexOf('.')).toLowerCase() : ''
  return `${cedenteId}/logistica/${contextoTipo}/${contextoId}/${tipoCodigo}/${randomUUID()}${ext}`
}

export async function enviarObjetoDocumento(path: string, file: File, mimeType: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.storage.from(DOCUMENTO_V2_BUCKET).upload(
    path,
    Buffer.from(await file.arrayBuffer()),
    { contentType: mimeType, upsert: false },
  )
  if (error) throw new Error(`Erro no upload documental: ${error.message}`)
}

export async function removerObjetoDocumento(path: string): Promise<void> {
  await createAdminClient().storage.from(DOCUMENTO_V2_BUCKET).remove([path])
}

export async function gerarUrlDocumento(path: string): Promise<string> {
  const { data, error } = await createAdminClient().storage.from(DOCUMENTO_V2_BUCKET).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) throw new Error('Nao foi possivel gerar o acesso temporario ao documento.')
  return data.signedUrl
}

export { nomeSeguro }
