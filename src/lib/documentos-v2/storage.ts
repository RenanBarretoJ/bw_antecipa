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
  contextoTipo: 'cte' | 'entrega' | 'antecipado'
  contextoId: string
  tipoCodigo: string
  nomeOriginal: string
}): string {
  const ext = nomeOriginal.includes('.') ? nomeOriginal.slice(nomeOriginal.lastIndexOf('.')).toLowerCase() : ''
  return `${cedenteId}/logistica/${contextoTipo}/${contextoId}/${tipoCodigo}/${randomUUID()}${ext}`
}

/**
 * Caminho para evidencia de webhook de transportadora ANTES da resolucao
 * do vinculo (P0_Claude_Retencao_Reprocessamento_Webhook_Transportadora)
 * -- nunca depende de cedente_id/nota_fiscal_id, que ainda nao existem
 * neste ponto do fluxo (o arquivo e persistido antes do matching, para
 * que NAO_IDENTIFICADO/REVISAO_MATCH/ERRO_REPROCESSAVEL possam ser
 * reprocessados de verdade depois).
 */
export function gerarCaminhoEvidenciaWebhookTransportadora({
  integracaoId,
  webhookEventoId,
  nomeOriginal,
}: {
  integracaoId: string
  webhookEventoId: string
  nomeOriginal: string
}): string {
  const ext = nomeOriginal.includes('.') ? nomeOriginal.slice(nomeOriginal.lastIndexOf('.')).toLowerCase() : ''
  return `webhooks-transportadora/${integracaoId}/${webhookEventoId}/${randomUUID()}${ext}`
}

export function gerarCaminhoDocumentoEstabelecimento({
  cedenteId,
  estabelecimentoId,
  tipoCodigo,
  nomeOriginal,
}: {
  cedenteId: string
  estabelecimentoId: string
  tipoCodigo: string
  nomeOriginal: string
}): string {
  const ext = nomeOriginal.includes('.') ? nomeOriginal.slice(nomeOriginal.lastIndexOf('.')).toLowerCase() : ''
  return `${cedenteId}/estabelecimentos/${estabelecimentoId}/${tipoCodigo}/${randomUUID()}${ext}`
}

export function gerarCaminhoDuplicata({
  cedenteId,
  notaFiscalId,
  nomeOriginal,
}: {
  cedenteId: string
  notaFiscalId: string
  nomeOriginal: string
}): string {
  const ext = nomeOriginal.includes('.') ? nomeOriginal.slice(nomeOriginal.lastIndexOf('.')).toLowerCase() : '.pdf'
  return `${cedenteId}/duplicatas/${notaFiscalId}/${randomUUID()}${ext}`
}

export function gerarCaminhoNotaFiscalRemessa({
  cedenteId,
  notaFiscalVendaId,
  nomeOriginal,
}: {
  cedenteId: string
  notaFiscalVendaId: string
  nomeOriginal: string
}): string {
  const ext = nomeOriginal.includes('.') ? nomeOriginal.slice(nomeOriginal.lastIndexOf('.')).toLowerCase() : '.xml'
  return `${cedenteId}/nota-fiscal-remessa/${notaFiscalVendaId}/${randomUUID()}${ext}`
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
  const { error } = await createAdminClient().storage.from(DOCUMENTO_V2_BUCKET).remove([path])
  if (error) throw new Error(`Erro ao compensar upload documental: ${error.message}`)
}

export async function gerarUrlDocumento(path: string): Promise<string> {
  const { data, error } = await createAdminClient().storage.from(DOCUMENTO_V2_BUCKET).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) throw new Error('Nao foi possivel gerar o acesso temporario ao documento.')
  return data.signedUrl
}

export { nomeSeguro }
