'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import {
  atualizarBloqueioUsuarioAuth,
  enviarConviteConsultorAuth,
  prepararConviteConsultorAuth,
  removerConviteAuthIncompleto,
} from '@/lib/admin/auth-admin.server'
import {
  convidarConsultorUsuarioSchema,
  criarConsultoriaInput,
  criarConsultoriaSchema,
  type ConsultoriaActionResult,
  type ConsultoriaPapel,
} from '@/lib/admin/consultorias'
import { obterAdminConsultoria } from '@/lib/admin/consultorias.server'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { AuthorizationError } from '@/lib/auth/authorization'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'

type RpcError = { code?: string; message?: string }

function falha(message: string, details?: string): ConsultoriaActionResult {
  return { success: false, message, notification: { type: 'error', message, details } }
}

function mapearErro(error: unknown, correlationId: string): ConsultoriaActionResult {
  if (error instanceof AuthorizationError) return falha(error.message)
  const value = error as RpcError
  console.error('[admin/consultorias] Falha em operacao administrativa', {
    correlationId,
    code: value?.code || 'UNEXPECTED',
  })
  if (value?.code === '42501') return falha(value.message || 'Voce nao possui autorizacao para concluir esta acao.')
  if (value?.code === '23505') return falha(value.message || 'CNPJ, e-mail ou usuario ja cadastrado.')
  if (value?.code === '23514') return falha(value.message || 'A alteracao viola uma regra de seguranca da Consultoria.')
  if (value?.code === 'P0002') return falha(value.message || 'Consultoria, usuario ou Fundo nao encontrado.')
  if (value?.code === '22023') return falha(value.message || 'Revise os dados informados.')
  return falha('Nao foi possivel concluir a operacao.', `Referencia: ${correlationId}`)
}

function revalidar(consultorId?: string) {
  revalidatePath('/admin')
  revalidatePath('/admin/consultorias')
  if (consultorId) revalidatePath(`/admin/consultorias/${consultorId}`)
}

async function compensarConvite(input: {
  context: Awaited<ReturnType<typeof requireSuperAdmin>>
  consultorId: string
  userId: string
  removerConsultoria: boolean
  correlationId: string
}) {
  const { error } = await input.context.supabase.rpc('admin_cancelar_convite_consultor', {
    p_consultor_id: input.consultorId,
    p_usuario_id: input.userId,
    p_remover_consultoria: input.removerConsultoria,
    p_correlation_id: input.correlationId,
  })
  if (error) throw error
  await removerConviteAuthIncompleto(input.userId)
}

export async function criarConsultoriaAdmin(formData: FormData): Promise<ConsultoriaActionResult> {
  const correlationId = randomUUID()
  try {
    const context = await requireSuperAdmin()
    const parsed = criarConsultoriaSchema.safeParse(criarConsultoriaInput(formData))
    if (!parsed.success) {
      return { success: false, message: 'Revise os campos informados.', fieldErrors: parsed.error.flatten().fieldErrors }
    }
    await autorizarEConsumirAcaoSensivel(context, 'criar_consultoria', String(formData.get('mfa_code') || ''))

    const invited = await prepararConviteConsultorAuth({
      email: parsed.data.ownerEmail,
      nome: parsed.data.ownerNome,
    })
    const { data, error } = await context.supabase.rpc('admin_criar_consultoria_convite_owner', {
      p_cnpj: parsed.data.cnpj,
      p_razao_social: parsed.data.razaoSocial,
      p_nome_fantasia: parsed.data.nomeFantasia || null,
      p_fundo_ids: parsed.data.fundoIds,
      p_usuario_id: invited.userId,
      p_usuario_nome: parsed.data.ownerNome,
      p_usuario_email: parsed.data.ownerEmail,
      p_correlation_id: correlationId,
    })
    if (error) {
      await removerConviteAuthIncompleto(invited.userId).catch(() => undefined)
      return mapearErro(error, correlationId)
    }

    const provisioned = data as unknown as { consultor_id?: string; usuario_id?: string; papel?: string }
    if (!provisioned?.consultor_id || provisioned.usuario_id !== invited.userId || provisioned.papel !== 'OWNER') {
      await removerConviteAuthIncompleto(invited.userId).catch(() => undefined)
      return falha('O provisionamento da Consultoria retornou um resultado inconsistente.', `Referencia: ${correlationId}`)
    }

    try {
      await enviarConviteConsultorAuth({
        ...invited,
        consultoriaNome: parsed.data.nomeFantasia || parsed.data.razaoSocial,
        papel: 'OWNER',
      })
    } catch (sendError) {
      console.error('[admin/consultorias] Falha ao enviar convite do OWNER', {
        correlationId,
        code: sendError instanceof Error ? sendError.name : 'SMTP_ERROR',
      })
      try {
        await compensarConvite({
          context,
          consultorId: provisioned.consultor_id,
          userId: invited.userId,
          removerConsultoria: true,
          correlationId,
        })
      } catch {
        return falha('O envio falhou e a compensacao requer reconciliacao administrativa.', `Referencia: ${correlationId}`)
      }
      return falha('Nao foi possivel enviar o convite. Nenhuma Consultoria foi mantida.', `Referencia: ${correlationId}`)
    }

    revalidar(provisioned.consultor_id)
    return {
      success: true,
      message: 'Consultoria criada e convite do OWNER enviado.',
      data: { id: provisioned.consultor_id },
      notification: { type: 'success', message: 'Consultoria criada e convite enviado.' },
    }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function convidarUsuarioConsultoriaAdmin(formData: FormData): Promise<ConsultoriaActionResult> {
  const correlationId = randomUUID()
  try {
    const context = await requireSuperAdmin()
    const parsed = convidarConsultorUsuarioSchema.safeParse({
      consultorId: String(formData.get('consultorId') || ''),
      nome: String(formData.get('nome') || ''),
      email: String(formData.get('email') || ''),
      papel: String(formData.get('papel') || ''),
    })
    if (!parsed.success) {
      return { success: false, message: 'Revise os campos informados.', fieldErrors: parsed.error.flatten().fieldErrors }
    }
    await autorizarEConsumirAcaoSensivel(context, 'convidar_usuario_consultoria', String(formData.get('mfa_code') || ''))
    const consultoria = await obterAdminConsultoria(parsed.data.consultorId)
    if (!consultoria || consultoria.status !== 'ativo') return falha('A Consultoria precisa estar ativa para convidar usuarios.')

    const invited = await prepararConviteConsultorAuth({ email: parsed.data.email, nome: parsed.data.nome })
    const { error } = await context.supabase.rpc('admin_preparar_convite_consultor_usuario', {
      p_consultor_id: parsed.data.consultorId,
      p_usuario_id: invited.userId,
      p_usuario_nome: parsed.data.nome,
      p_usuario_email: parsed.data.email,
      p_papel: parsed.data.papel,
      p_correlation_id: correlationId,
    })
    if (error) {
      await removerConviteAuthIncompleto(invited.userId).catch(() => undefined)
      return mapearErro(error, correlationId)
    }

    try {
      await enviarConviteConsultorAuth({
        ...invited,
        consultoriaNome: consultoria.nome_fantasia || consultoria.razao_social,
        papel: parsed.data.papel,
      })
    } catch (sendError) {
      console.error('[admin/consultorias] Falha ao enviar convite adicional', {
        correlationId,
        code: sendError instanceof Error ? sendError.name : 'SMTP_ERROR',
      })
      try {
        await compensarConvite({
          context,
          consultorId: parsed.data.consultorId,
          userId: invited.userId,
          removerConsultoria: false,
          correlationId,
        })
      } catch {
        return falha('O envio falhou e a compensacao requer reconciliacao administrativa.', `Referencia: ${correlationId}`)
      }
      return falha('Nao foi possivel enviar o convite. Nenhum acesso foi mantido.', `Referencia: ${correlationId}`)
    }

    revalidar(parsed.data.consultorId)
    return {
      success: true,
      message: 'Convite de usuario da Consultoria enviado.',
      data: { id: parsed.data.consultorId },
      notification: { type: 'success', message: 'Convite enviado.' },
    }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function alterarStatusConsultoriaAdmin(input: {
  consultorId: string
  ativar: boolean
  mfaCode: string
}): Promise<ConsultoriaActionResult> {
  const correlationId = randomUUID()
  try {
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'atualizar_consultoria', input.mfaCode)
    const { error } = await context.supabase.rpc('admin_atualizar_status_consultoria', {
      p_consultor_id: input.consultorId,
      p_ativo: input.ativar,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    revalidar(input.consultorId)
    const message = input.ativar ? 'Consultoria reativada.' : 'Consultoria desativada.'
    return { success: true, message, data: { id: input.consultorId }, notification: { type: 'success', message } }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function atualizarUsuarioConsultoriaAdmin(input: {
  consultorId: string
  userId: string
  papel: ConsultoriaPapel
  ativar: boolean
  mfaCode: string
}): Promise<ConsultoriaActionResult> {
  const correlationId = randomUUID()
  try {
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'atualizar_consultoria', input.mfaCode)
    if (input.ativar) await atualizarBloqueioUsuarioAuth(input.userId, false)
    const { error } = await context.supabase.rpc('admin_atualizar_usuario_consultoria', {
      p_consultor_id: input.consultorId,
      p_user_id: input.userId,
      p_papel: input.papel,
      p_ativo: input.ativar,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)

    let warning: string | undefined
    if (!input.ativar) {
      try { await atualizarBloqueioUsuarioAuth(input.userId, true) }
      catch { warning = 'A membership foi revogada, mas o bloqueio adicional no Auth deve ser verificado.' }
    }
    revalidar(input.consultorId)
    const message = input.ativar ? 'Usuario da Consultoria atualizado.' : 'Usuario da Consultoria desativado.'
    return {
      success: true,
      message,
      data: { id: input.consultorId },
      notification: warning ? { type: 'warning', message, details: warning } : { type: 'success', message },
    }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function atualizarFundosConsultoriaAdmin(input: {
  consultorId: string
  fundoIds: string[]
  mfaCode: string
}): Promise<ConsultoriaActionResult> {
  const correlationId = randomUUID()
  try {
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'atualizar_fundos_consultoria', input.mfaCode)
    const { error } = await context.supabase.rpc('admin_atualizar_fundos_consultoria', {
      p_consultor_id: input.consultorId,
      p_fundo_ids: input.fundoIds,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    revalidar(input.consultorId)
    return {
      success: true,
      message: 'Fundos autorizados atualizados.',
      data: { id: input.consultorId },
      notification: { type: 'success', message: 'Fundos autorizados atualizados.' },
    }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}
