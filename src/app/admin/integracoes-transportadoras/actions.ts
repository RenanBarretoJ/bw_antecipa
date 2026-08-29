'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { AuthorizationError } from '@/lib/auth/authorization'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import type { AdminTechnicalActionResult } from '@/lib/admin/configuracoes-tecnicas'
import {
  adminCriarIntegracaoTransportadoraSchema,
  adminIntegracaoTransportadoraConfirmationSchema,
  adminReprocessarWebhookEventoSchema,
  adminRevogarTokenTransportadoraSchema,
} from '@/lib/admin/integracoes-transportadoras'
import { reprocessarWebhookComprovanteTransportadora } from '@/lib/integracoes/webhook-comprovante-transportadora.server'

type RpcError = { code?: string; message?: string }

function rpcRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Resposta administrativa invalida.')
  }
  return value as Record<string, unknown>
}

function rpcString(value: unknown, field: string): string {
  const result = rpcRecord(value)[field]
  if (typeof result !== 'string' || !result) throw new Error('Resposta administrativa incompleta.')
  return result
}

function respostaErro(message: string, correlationId?: string): AdminTechnicalActionResult {
  return {
    success: false,
    message,
    notification: { type: 'error', message, details: correlationId ? `Referencia: ${correlationId}` : undefined },
  }
}

function mapearErro(error: unknown, correlationId: string): AdminTechnicalActionResult {
  if (error instanceof AuthorizationError) return respostaErro(error.message, correlationId)
  const value = error as RpcError
  const message = error instanceof Error ? error.message : value?.message
  if (value?.code === '42501') return respostaErro('Acesso restrito ao Super Admin.', correlationId)
  if (value?.code === '23505') return respostaErro('Ja existe um registro conflitante para esta integracao.', correlationId)
  if (message) return respostaErro(message, correlationId)
  console.error('[admin/integracoes-transportadoras]', { correlationId, code: value?.code || 'unexpected' })
  return respostaErro('Nao foi possivel concluir a operacao.', correlationId)
}

function sucesso(
  message: string,
  id: string,
  extra?: { token?: string; tokenDisplay?: string; integrationId?: string },
): AdminTechnicalActionResult {
  return { success: true, message, data: { id, ...extra }, notification: { type: 'success', message } }
}

function atualizarTela() {
  revalidatePath('/admin/integracoes-transportadoras')
}

export async function criarIntegracaoTransportadoraAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = adminCriarIntegracaoTransportadoraSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Revise os dados da integracao.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'criar_integracao_transportadora', parsed.data.mfaCode)
    const { data, error } = await context.supabase.rpc('admin_criar_integracao_transportadora', {
      p_fundo_id: parsed.data.fundoId,
      p_provider: parsed.data.provider,
      p_nome: parsed.data.nome || null,
      p_cnpj_transportadora: parsed.data.cnpjTransportadora || null,
    })
    if (error) return mapearErro(error, correlationId)
    atualizarTela()
    return sucesso('Integracao criada. Copie o token agora -- ele nao sera mostrado novamente.', rpcString(data, 'integracao_id'), {
      token: rpcString(data, 'token'),
      tokenDisplay: rpcString(data, 'token_display'),
    })
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function ativarIntegracaoTransportadoraAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = adminIntegracaoTransportadoraConfirmationSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Confirmacao invalida.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'ativar_integracao_transportadora', parsed.data.mfaCode)
    const { error } = await context.supabase.rpc('admin_ativar_integracao_transportadora', { p_integracao_id: parsed.data.id })
    if (error) return mapearErro(error, correlationId)
    atualizarTela()
    return sucesso('Integracao ativada.', parsed.data.id)
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function desativarIntegracaoTransportadoraAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = adminIntegracaoTransportadoraConfirmationSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Confirmacao invalida.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'desativar_integracao_transportadora', parsed.data.mfaCode)
    const { error } = await context.supabase.rpc('admin_desativar_integracao_transportadora', { p_integracao_id: parsed.data.id })
    if (error) return mapearErro(error, correlationId)
    atualizarTela()
    return sucesso('Integracao desativada.', parsed.data.id)
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function rotacionarTokenIntegracaoTransportadoraAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = adminIntegracaoTransportadoraConfirmationSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Confirmacao invalida.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'rotacionar_token_integracao_transportadora', parsed.data.mfaCode)
    const { data, error } = await context.supabase.rpc('admin_rotacionar_token_integracao_transportadora', { p_integracao_id: parsed.data.id })
    if (error) return mapearErro(error, correlationId)
    atualizarTela()
    return sucesso('Token rotacionado. Copie o novo token agora -- ele nao sera mostrado novamente.', parsed.data.id, {
      token: rpcString(data, 'token'),
      tokenDisplay: rpcString(data, 'token_display'),
    })
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function revogarTokenIntegracaoTransportadoraAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = adminRevogarTokenTransportadoraSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Confirmacao invalida.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'revogar_token_integracao_transportadora', parsed.data.mfaCode)
    const { error } = await context.supabase.rpc('admin_revogar_token_integracao_transportadora', {
      p_integracao_id: parsed.data.id,
      p_motivo: parsed.data.motivo || null,
    })
    if (error) return mapearErro(error, correlationId)
    atualizarTela()
    return sucesso('Token revogado. O webhook desta integracao deixara de autenticar imediatamente.', parsed.data.id)
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function reprocessarWebhookEventoTransportadoraAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = adminReprocessarWebhookEventoSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Confirmacao invalida.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'reprocessar_webhook_evento_transportadora', parsed.data.mfaCode)
    const resultado = await reprocessarWebhookComprovanteTransportadora(parsed.data.id)
    revalidatePath(`/admin/integracoes-transportadoras/eventos/${parsed.data.id}`)
    revalidatePath('/admin/integracoes-transportadoras/eventos')
    return {
      ...sucesso(`Evento reprocessado -- novo status: ${resultado.status}.`, parsed.data.id),
      notification: { type: resultado.status === 'EVIDENCIA_INDISPONIVEL' ? 'warning' : 'success', message: `Evento reprocessado -- novo status: ${resultado.status}.${resultado.detalhe ? ` ${resultado.detalhe}` : ''}` },
    }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}
