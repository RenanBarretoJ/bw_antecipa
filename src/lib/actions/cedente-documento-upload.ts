'use server'

import { requireCedenteManagementAccess } from '@/lib/auth/authorization'
import { DOCUMENT_TYPES, type DocumentoTipo } from '@/lib/types/domain'
import {
  criarCaminhoDocumentoCadastral,
  DOCUMENTO_CADASTRAL_BUCKET,
  validarMetadadosDocumentoCadastral,
} from '@/lib/documentos-cadastrais/upload'
import { createAdminClient } from '@/lib/supabase/server'
import type { DocumentoUploadIntentRow } from '@/types/database'
import { notificarGestores } from './notificacao'

type UploadMetadata = { tipo: string; nomeArquivo: string; mime: string; tamanho: number; representanteId?: string | null; cedenteId?: string }
type UploadResponse = { success: true; message: string } | { success: false; message: string }
type PrepareResponse =
  | { success: true; storagePath: string; uploadToken: string; intent: string }
  | { success: false; message: string }

export type EstadoUploadDocumento = 'NOT_UPLOADED' | 'UPLOADED_NOT_FINALIZED' | 'FINALIZED' | 'INVALID' | 'EXPIRED' | 'FAILED' | 'CLEANED'
// Signed Storage upload URL remains valid for two hours; never remove while it can still be reused.
const CLEANUP_GRACE_MS = 125 * 60 * 1000
const INTENT_TTL_MS = 15 * 60 * 1000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function carregarIntentDoContexto(intentId: string, context: Awaited<ReturnType<typeof requireCedenteManagementAccess>>): Promise<DocumentoUploadIntentRow | null> {
  if (!UUID_PATTERN.test(intentId)) return null
  const { data: intent, error } = await context.supabase.from('documento_upload_intents')
    .select('*').eq('id', intentId).eq('usuario_id', context.user.id).eq('cedente_id', context.cedente.id).maybeSingle()
  if (error) throw new Error('Nao foi possivel consultar o estado do envio.')
  if (!intent || intent.storage_bucket !== DOCUMENTO_CADASTRAL_BUCKET) return null
  const expectedPath = criarCaminhoDocumentoCadastral({
    cnpj: context.cedente.cnpj, tipo: intent.tipo_documento, nomeArquivo: intent.nome_original,
    representanteId: intent.representante_id, uploadId: intent.id,
  })
  if (expectedPath !== intent.storage_path || validarMetadadosDocumentoCadastral({ nome: intent.nome_original, mime: intent.mime_type, tamanho: intent.tamanho_esperado })) return null
  return intent
}

async function marcarFalhaIntent(intentId: string, code: string): Promise<void> {
  const { error } = await createAdminClient().from('documento_upload_intents')
    .update({ status: 'FAILED', last_error_code: code, updated_at: new Date().toISOString() })
    .eq('id', intentId).in('status', ['PREPARED', 'UPLOADED', 'FAILED'])
  if (error) console.warn('document-upload-intent-status-failed', { code })
}

export async function reconciliarUploadDocumentoCadastral(intentId: string, cedenteId?: string): Promise<EstadoUploadDocumento> {
  const context = await requireCedenteManagementAccess(cedenteId)
  const intent = await carregarIntentDoContexto(intentId, context)
  if (!intent) return 'INVALID'
  if (intent.status === 'FINALIZED') return 'FINALIZED'
  if (intent.status === 'CLEANED') return 'CLEANED'
  if (intent.status === 'CLEANUP_PENDING') return 'EXPIRED'
  if (intent.status === 'EXPIRED' || Date.now() >= Date.parse(intent.expires_at)) return 'EXPIRED'
  const { data: info, error } = await context.supabase.storage.from(DOCUMENTO_CADASTRAL_BUCKET).info(intent.storage_path)
  if (error || !info) {
    if (error && !['404', 'not_found', 'NoSuchKey'].includes(error.name) && !/not found|not exist/i.test(error.message)) {
      throw new Error('Nao foi possivel consultar o arquivo enviado.')
    }
    return intent.status === 'FAILED' ? 'FAILED' : 'NOT_UPLOADED'
  }
  if (info.size !== intent.tamanho_esperado || info.contentType?.toLowerCase() !== intent.mime_type) return 'INVALID'
  return 'UPLOADED_NOT_FINALIZED'
}

async function verificarAtualizacaoPermitida(
  supabase: Awaited<ReturnType<typeof requireCedenteManagementAccess>>['supabase'],
  cedenteId: string,
  tipo: DocumentoTipo,
  representanteId: string | null,
): Promise<boolean> {
  let query = supabase.from('documentos')
    .select('status, atualizacao_solicitada_em')
    .eq('cedente_id', cedenteId)
    .eq('tipo', tipo)
    .order('versao', { ascending: false })
    .limit(1)
  query = representanteId ? query.eq('representante_id', representanteId) : query.is('representante_id', null)
  const { data, error } = await query
  if (error) throw new Error('Nao foi possivel verificar o estado documental.')
  const ultimo = data?.[0]
  return !ultimo || ultimo.status === 'aguardando_envio' || ultimo.status === 'reprovado' || !!ultimo.atualizacao_solicitada_em
}

export async function prepararUploadDocumentoCadastral(input: UploadMetadata): Promise<PrepareResponse> {
  const context = await requireCedenteManagementAccess(input?.cedenteId)
  const { supabase, cedente, user } = context
  if (cedente.status === 'bloqueado') return { success: false, message: 'Cadastro de cedente bloqueado.' }
  if (!input || typeof input.tipo !== 'string' || !DOCUMENT_TYPES.includes(input.tipo as DocumentoTipo)) {
    return { success: false, message: 'Tipo de documento invalido.' }
  }
  if (typeof input.nomeArquivo !== 'string' || typeof input.mime !== 'string' || typeof input.tamanho !== 'number' ||
    (input.representanteId != null && (typeof input.representanteId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.representanteId)))) {
    return { success: false, message: 'Dados do arquivo invalidos.' }
  }
  const tipo = input.tipo as DocumentoTipo
  const representanteId = input.representanteId || null
  const metadataError = validarMetadadosDocumentoCadastral({ nome: input.nomeArquivo, mime: input.mime, tamanho: input.tamanho })
  if (metadataError) return { success: false, message: metadataError }

  if (representanteId) {
    const { data, error } = await supabase.from('representantes').select('id')
      .eq('id', representanteId).eq('cedente_id', cedente.id).maybeSingle()
    if (error || !data) return { success: false, message: 'Representante nao autorizado.' }
  }
  if (!await verificarAtualizacaoPermitida(supabase, cedente.id, tipo, representanteId)) {
    return { success: false, message: 'Este documento nao permite um novo envio no momento.' }
  }

  const uploadId = crypto.randomUUID()
  const storagePath = criarCaminhoDocumentoCadastral({
    cnpj: cedente.cnpj,
    tipo,
    nomeArquivo: input.nomeArquivo,
    representanteId,
    uploadId,
  })
  const now = Date.now()
  // Service role is used only server-side after the organizational gate, to
  // create a transport record. The browser never receives this credential.
  const admin = createAdminClient()
  const { error: persistError } = await admin.from('documento_upload_intents').insert({
    id: uploadId, cedente_id: cedente.id, usuario_id: user.id,
    tipo_documento: tipo, representante_id: representanteId,
    storage_bucket: DOCUMENTO_CADASTRAL_BUCKET, storage_path: storagePath,
    nome_original: input.nomeArquivo, mime_type: input.mime, tamanho_esperado: input.tamanho,
    expires_at: new Date(now + INTENT_TTL_MS).toISOString(),
    // Conservative margin includes any delay between DB insert and URL signing.
    cleanup_after: new Date(now + CLEANUP_GRACE_MS + 55 * 60_000).toISOString(),
  })
  if (persistError) return { success: false, message: 'Nao foi possivel preparar o envio do arquivo. Tente novamente.' }
  const { data, error } = await supabase.storage.from(DOCUMENTO_CADASTRAL_BUCKET).createSignedUploadUrl(storagePath)
  if (error || !data) {
    await admin.from('documento_upload_intents').update({ status: 'FAILED', last_error_code: 'SIGNED_URL_FAILED', updated_at: new Date().toISOString() }).eq('id', uploadId).eq('status', 'PREPARED')
    return { success: false, message: 'Nao foi possivel preparar o envio do arquivo. Tente novamente.' }
  }
  return { success: true, storagePath, uploadToken: data.token, intent: uploadId }
}

export async function finalizarUploadDocumentoCadastral(intentId: string, cedenteId?: string): Promise<UploadResponse> {
  const context = await requireCedenteManagementAccess(cedenteId)
  const { supabase, cedente, user } = context
  const intent = await carregarIntentDoContexto(intentId, context)
  if (!intent || intent.usuario_id !== user.id || intent.cedente_id !== cedente.id || cedente.status === 'bloqueado') {
    return { success: false, message: 'Envio expirado ou nao autorizado. Selecione o arquivo novamente.' }
  }
  if (intent.status === 'FINALIZED') return { success: true, message: 'Documento enviado com sucesso!' }
  if (['CLEANUP_PENDING', 'CLEANED', 'EXPIRED'].includes(intent.status) || Date.now() >= Date.parse(intent.expires_at)) {
    return { success: false, message: 'Envio expirado ou em limpeza. Selecione o arquivo novamente.' }
  }
  const bucket = supabase.storage.from(DOCUMENTO_CADASTRAL_BUCKET)
  const { data: info, error: infoError } = await bucket.info(intent.storage_path)
  if (infoError || !info) return { success: false, message: 'Arquivo nao encontrado. Tente enviar novamente.' }
  if (info.size !== intent.tamanho_esperado || info.contentType?.toLowerCase() !== intent.mime_type) {
    await marcarFalhaIntent(intent.id, 'FILE_METADATA_MISMATCH')
    return { success: false, message: 'O arquivo enviado nao corresponde ao arquivo selecionado. Tente novamente.' }
  }

  if (!await verificarAtualizacaoPermitida(supabase, cedente.id, intent.tipo_documento, intent.representante_id)) {
    await marcarFalhaIntent(intent.id, 'DOCUMENT_STATE_CHANGED')
    return { success: false, message: 'O estado do documento mudou durante o envio. Selecione o arquivo novamente.' }
  }
  const { data, error } = await supabase.rpc('finalizar_documento_upload_intent', { p_intent_id: intent.id })
  if (error || !data?.length) {
    await marcarFalhaIntent(intent.id, error?.code || 'FINALIZE_FAILED')
    return { success: false, message: 'O arquivo foi enviado, mas nao foi possivel concluir o registro do documento. Tente novamente.' }
  }

  // Audit is committed by the RPC with the version. Notification is best effort.
  if (data[0].novo_registro) {
    try {
      await notificarGestores('Novo documento enviado',
        `O cedente CNPJ ${cedente.cnpj} enviou o documento "${intent.tipo_documento}" (v${data[0].versao}).`,
        'documento_enviado')
    } catch { console.warn('document-upload-notification-failed', { intentId: intent.id }) }
  }
  return { success: true, message: 'Documento enviado com sucesso!' }
}
