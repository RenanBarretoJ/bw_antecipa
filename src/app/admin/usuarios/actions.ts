'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { AuthorizationError } from '@/lib/auth/authorization'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import { atualizarBloqueioUsuarioAuth, enviarConviteUsuarioAuth, prepararConviteUsuarioAuth, removerConviteAuthIncompleto, removerFatoresMfaAuth } from '@/lib/admin/auth-admin.server'
import {
  adminUsuarioConviteSchema,
  adminVinculoBuscaSchema,
  conviteInputFromFormData,
  type AdminVinculoBuscaActionResult,
  type AdminConviteGestorEstado,
  type AdminConviteGestorPreparado,
  type AdminUsuarioActionResult,
  type AdminUsuarioDetalhe,
} from '@/lib/admin/usuarios'
import { buscarVinculosAdmin } from '@/lib/admin/usuarios.server'

type RpcError = { code?: string; message?: string }

function falha(message: string, details?: string): AdminUsuarioActionResult {
  return { success: false, message, notification: { type: 'error', message, details } }
}

function mapearErro(error: unknown, correlationId: string): AdminUsuarioActionResult {
  if (error instanceof AuthorizationError) return falha(error.message)
  const value = error as RpcError
  console.error('[admin/usuarios] Falha em operacao administrativa', {
    correlationId,
    code: value?.code || 'UNEXPECTED',
  })
  if (value?.code === '42501') return falha(value.message?.includes('ultimo') ? value.message : 'Voce nao possui autorizacao para concluir esta acao.')
  if (value?.code === 'P0002') return falha('Usuario, fundo ou vinculo nao encontrado.')
  if (value?.code === '23514' || value?.message?.includes('ultimo Super Admin')) return falha('O ultimo Super Admin ativo nao pode ser removido ou desativado.')
  if (value?.code === '22023') return falha('A operacao solicitada nao e compativel com o usuario.')
  return falha('Nao foi possivel concluir a operacao.', `Referencia: ${correlationId}`)
}

function revalidarUsuario(usuarioId?: string, fundoId?: string) {
  revalidatePath('/admin')
  revalidatePath('/admin/usuarios')
  revalidatePath('/admin/fundos')
  if (usuarioId) revalidatePath(`/admin/usuarios/${usuarioId}`)
  if (fundoId) revalidatePath(`/admin/fundos/${fundoId}`)
}

export async function buscarCandidatosVinculoAdmin(input: unknown): Promise<AdminVinculoBuscaActionResult> {
  const parsed = adminVinculoBuscaSchema.safeParse(input)
  if (!parsed.success) return { success: false, message: 'Informe ao menos dois caracteres para buscar.' }
  try {
    const data = await buscarVinculosAdmin(parsed.data)
    return { success: true, data }
  } catch (error) {
    if (error instanceof AuthorizationError) return { success: false, message: error.message }
    return { success: false, message: 'Nao foi possivel realizar a busca.' }
  }
}

export async function convidarUsuarioAdmin(formData: FormData): Promise<AdminUsuarioActionResult> {
  const correlationId = randomUUID()
  try {
    const context = await requireSuperAdmin()
    const parsed = adminUsuarioConviteSchema.safeParse(conviteInputFromFormData(formData))
    if (!parsed.success) {
      return { success: false, message: 'Revise os campos informados.', fieldErrors: parsed.error.flatten().fieldErrors }
    }
    await autorizarEConsumirAcaoSensivel(context, 'convidar_usuario_admin', String(formData.get('mfa_code') || ''))

    const { data: existingRaw, error: existingError } = await context.supabase.rpc('admin_obter_usuario_por_email', { p_email: parsed.data.email })
    if (existingError) return mapearErro(existingError, correlationId)
    const existing = existingRaw as unknown as AdminUsuarioDetalhe | null

    if (existing) {
      const { data: inviteRaw, error: inviteError } = await context.supabase.rpc('admin_consultar_convite_gestor', {
        p_usuario_id: existing.id,
      })
      if (inviteError) return mapearErro(inviteError, correlationId)
      const invite = inviteRaw as unknown as AdminConviteGestorEstado | null
      if (invite && invite.status !== 'ACEITO') {
        const message = invite.status === 'PENDENTE'
          ? 'Este usuario ja possui um convite de Gestor pendente.'
          : 'O convite anterior deste usuario nao pode mais ser utilizado. Cancele o cadastro pendente antes de criar outro.'
        return {
          success: false,
          message,
          notification: { type: 'warning', message },
        }
      }

      if (parsed.data.tipo === 'gestor') {
        if (existing.papel_primario !== 'gestor') {
          return falha('Este e-mail pertence a um perfil que nao pode ser convertido automaticamente em Gestor.')
        }
        const { error } = await context.supabase.rpc('admin_vincular_gestor_fundos', {
          p_usuario_id: existing.id,
          p_fundo_ids: parsed.data.fundoIds,
          p_correlation_id: correlationId,
        })
        if (error) return mapearErro(error, correlationId)
        revalidarUsuario(existing.id)
        return { success: true, message: 'Usuario existente atualizado sem duplicidade.', data: { id: existing.id, existente: true }, notification: { type: 'success', message: 'Acessos do Gestor atualizados.' } }
      }

      if (existing.super_admin) {
        return { success: true, message: 'O usuario ja possui capacidade Super Admin.', data: { id: existing.id, existente: true }, notification: { type: 'success', message: 'O usuario ja era Super Admin.' } }
      }
      if (existing.papel_primario !== 'gestor') {
        return falha('Somente um Gestor existente pode receber a capacidade Super Admin complementar.')
      }
      const { error } = await context.supabase.rpc('admin_conceder_super_admin', { p_usuario_id: existing.id, p_correlation_id: correlationId })
      if (error) return mapearErro(error, correlationId)
      revalidarUsuario(existing.id)
      return { success: true, message: 'Capacidade Super Admin concedida.', data: { id: existing.id, existente: true }, notification: { type: 'success', message: 'Capacidade Super Admin concedida.' } }
    }

    const invited = await prepararConviteUsuarioAuth({
      email: parsed.data.email,
      nome: parsed.data.nome,
      tipo: parsed.data.tipo,
    })

    let fundos: string[] = []
    const { data: provisionedRaw, error: provisionError } = parsed.data.tipo === 'gestor'
      ? await context.supabase.rpc('admin_preparar_convite_gestor', {
          p_usuario_id: invited.userId,
          p_nome: parsed.data.nome,
          p_fundo_ids: parsed.data.fundoIds,
          p_correlation_id: correlationId,
        })
      : await context.supabase.rpc('admin_finalizar_convite_usuario', {
          p_usuario_id: invited.userId,
          p_tipo: parsed.data.tipo,
          p_nome: parsed.data.nome,
          p_fundo_ids: parsed.data.fundoIds,
          p_correlation_id: correlationId,
        })

    if (provisionError) {
      try {
        await removerConviteAuthIncompleto(invited.userId)
      } catch {
        return falha('O convite foi criado, mas o provisionamento nao foi concluido e requer reconciliacao administrativa.', `Referencia: ${correlationId}`)
      }
      return mapearErro(provisionError, correlationId)
    }

    if (parsed.data.tipo === 'gestor') {
      const prepared = provisionedRaw as unknown as AdminConviteGestorPreparado
      if (prepared?.status !== 'PENDENTE'
          || !Array.isArray(prepared.fundos)
          || prepared.fundos.length !== parsed.data.fundoIds.length) {
        await removerConviteAuthIncompleto(invited.userId)
        return falha('O convite nao preservou todos os fundos selecionados.', `Referencia: ${correlationId}`)
      }
      fundos = prepared.fundos.map((fundo) => fundo.nome)
    }

    try {
      await enviarConviteUsuarioAuth({ ...invited, fundos })
    } catch (sendError) {
      console.error('[admin/usuarios] Falha ao enviar convite administrativo', {
        correlationId,
        code: sendError instanceof Error ? sendError.name : 'SMTP_ERROR',
        userId: invited.userId,
      })
      try {
        await removerConviteAuthIncompleto(invited.userId)
      } catch {
        return falha('O convite foi provisionado, mas o envio falhou e requer reconciliacao administrativa.', `Referencia: ${correlationId}`)
      }
      return falha('Nao foi possivel enviar o convite. Nenhum acesso foi mantido.', `Referencia: ${correlationId}`)
    }

    revalidarUsuario(invited.userId)
    const message = parsed.data.tipo === 'gestor' ? 'Convite de Gestor enviado.' : 'Convite de Super Admin enviado.'
    return { success: true, message, data: { id: invited.userId }, notification: { type: 'success', message } }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function alterarVinculoGestorAdmin(input: {
  usuarioId: string
  fundoId: string
  operacao: 'vincular' | 'revogar' | 'reativar'
  mfaCode: string
}): Promise<AdminUsuarioActionResult> {
  const correlationId = randomUUID()
  try {
    const context = await requireSuperAdmin()
    const actionType = input.operacao === 'revogar' ? 'revogar_gestor_fundo' : input.operacao === 'reativar' ? 'reativar_gestor_fundo' : 'vincular_gestor_fundo'
    await autorizarEConsumirAcaoSensivel(context, actionType, input.mfaCode)
    const rpc = input.operacao === 'revogar' ? 'admin_revogar_gestor_fundo' : input.operacao === 'reativar' ? 'admin_reativar_gestor_fundo' : 'admin_vincular_gestor_fundo'
    const { error } = await context.supabase.rpc(rpc, { p_usuario_id: input.usuarioId, p_fundo_id: input.fundoId, p_correlation_id: correlationId })
    if (error) return mapearErro(error, correlationId)
    revalidarUsuario(input.usuarioId, input.fundoId)
    const message = input.operacao === 'revogar' ? 'Vinculo revogado.' : input.operacao === 'reativar' ? 'Vinculo reativado.' : 'Gestor vinculado ao fundo.'
    return { success: true, message, data: { id: input.usuarioId }, notification: { type: 'success', message } }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function alterarStatusUsuarioAdmin(input: { usuarioId: string; ativar: boolean; mfaCode: string }): Promise<AdminUsuarioActionResult> {
  const correlationId = randomUUID()
  try {
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, input.ativar ? 'reativar_usuario' : 'desativar_usuario', input.mfaCode)

    // Ao reativar, remover primeiro o bloqueio Auth. Se a RPC falhar, o perfil
    // ainda inativo continua negando acesso. Ao desativar, o perfil e a fonte
    // primaria e o ban Auth e uma segunda camada best effort.
    if (input.ativar) await atualizarBloqueioUsuarioAuth(input.usuarioId, false)
    const rpc = input.ativar ? 'admin_reativar_usuario' : 'admin_desativar_usuario'
    const { error } = await context.supabase.rpc(rpc, { p_usuario_id: input.usuarioId, p_correlation_id: correlationId })
    if (error) return mapearErro(error, correlationId)

    let authWarning: string | undefined
    if (!input.ativar) {
      try { await atualizarBloqueioUsuarioAuth(input.usuarioId, true) }
      catch { authWarning = 'O acesso da aplicacao foi revogado, mas a revogacao adicional no Auth deve ser verificada.' }
    }
    revalidarUsuario(input.usuarioId)
    const message = input.ativar ? 'Usuario reativado.' : 'Usuario desativado.'
    return {
      success: true,
      message,
      data: { id: input.usuarioId },
      notification: authWarning ? { type: 'warning', message, details: authWarning } : { type: 'success', message },
    }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function alterarSuperAdminAdmin(input: { usuarioId: string; conceder: boolean; mfaCode: string }): Promise<AdminUsuarioActionResult> {
  const correlationId = randomUUID()
  try {
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, input.conceder ? 'conceder_super_admin' : 'revogar_super_admin', input.mfaCode)
    const rpc = input.conceder ? 'admin_conceder_super_admin' : 'admin_revogar_super_admin'
    const { error } = await context.supabase.rpc(rpc, { p_usuario_id: input.usuarioId, p_correlation_id: correlationId })
    if (error) return mapearErro(error, correlationId)
    revalidarUsuario(input.usuarioId)
    const message = input.conceder ? 'Capacidade Super Admin concedida.' : 'Capacidade Super Admin revogada.'
    return { success: true, message, data: { id: input.usuarioId }, notification: { type: 'success', message } }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function resetarMfaUsuarioAdmin(input: { usuarioId: string; mfaCode: string }): Promise<AdminUsuarioActionResult> {
  const correlationId = randomUUID()
  try {
    const context = await requireSuperAdmin()
    if (input.usuarioId === context.user.id) return falha('O reset administrativo do proprio MFA esta bloqueado. Use Minha Seguranca.')
    await autorizarEConsumirAcaoSensivel(context, 'reset_mfa_administrativo', input.mfaCode)
    const { removidos } = await removerFatoresMfaAuth(input.usuarioId)
    const { error } = await context.supabase.rpc('admin_concluir_reset_mfa', {
      p_usuario_id: input.usuarioId,
      p_fatores_removidos: removidos,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    revalidarUsuario(input.usuarioId)
    return { success: true, message: 'MFA resetado. O usuario devera configurar um novo fator.', data: { id: input.usuarioId }, notification: { type: 'success', message: 'MFA resetado com seguranca.' } }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}
