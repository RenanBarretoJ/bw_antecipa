'use server'

import { revalidatePath } from 'next/cache'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { AuthorizationError } from '@/lib/auth/authorization'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import {
  adminFundoSchema,
  fundoInputFromFormData,
  type AdminFundoActionResult,
  type AdminFundoInput,
} from '@/lib/admin/fundos'

type RpcError = { code?: string; message?: string }

function falha(message: string, details?: string): AdminFundoActionResult {
  return { success: false, message, notification: { type: 'error', message, details } }
}

function mapearErro(error: unknown): AdminFundoActionResult {
  if (error instanceof AuthorizationError) return falha(error.message)
  const value = error as RpcError
  if (value?.code === '23505') return falha('Ja existe um fundo com este CNPJ.')
  if (value?.code === '40001') return falha('O cadastro foi alterado por outro usuario. Recarregue a pagina e tente novamente.')
  if (value?.code === '42501') return falha('Voce nao possui autorizacao para administrar fundos.')
  if (value?.code === 'P0002') return falha('Fundo nao encontrado.')
  const message = error instanceof Error ? error.message : value?.message
  return falha('Nao foi possivel concluir a operacao.', message ? 'Consulte os logs administrativos usando o correlation ID da requisicao.' : undefined)
}

function validarEntrada(formData: FormData) {
  return adminFundoSchema.safeParse(fundoInputFromFormData(formData))
}

function argsEstruturais(input: AdminFundoInput) {
  return {
    p_nome: input.nome,
    p_cnpj: input.cnpj,
    p_administradora_nome: input.administradora_nome,
    p_administradora_cnpj: input.administradora_cnpj,
    p_gestora_nome: input.gestora_nome,
    p_gestora_cnpj: input.gestora_cnpj,
    p_custodiante_nome: input.custodiante_nome,
    p_custodiante_cnpj: input.custodiante_cnpj,
    p_administradora_endereco: input.administradora_endereco,
    p_administradora_ato_declaratorio: input.administradora_ato_declaratorio,
    p_contato_nome: input.contato_nome,
    p_contato_email: input.contato_email,
  }
}

export async function criarFundoAdmin(formData: FormData): Promise<AdminFundoActionResult> {
  try {
    const context = await requireSuperAdmin()
    const parsed = validarEntrada(formData)
    if (!parsed.success) {
      return { success: false, message: 'Revise os campos informados.', fieldErrors: parsed.error.flatten().fieldErrors }
    }
    await autorizarEConsumirAcaoSensivel(context, 'criar_fundo', String(formData.get('mfa_code') || ''))
    const { data, error } = await context.supabase.rpc('admin_criar_fundo', argsEstruturais(parsed.data))
    if (error) return mapearErro(error)
    const fundo = data as unknown as { id: string }
    revalidatePath('/admin')
    revalidatePath('/admin/fundos')
    return { success: true, message: 'Fundo criado como inativo.', data: { id: fundo.id }, notification: { type: 'success', message: 'Fundo criado como inativo.' } }
  } catch (error) {
    return mapearErro(error)
  }
}

export async function atualizarFundoAdmin(formData: FormData): Promise<AdminFundoActionResult> {
  try {
    const context = await requireSuperAdmin()
    const fundoId = String(formData.get('fundo_id') || '')
    const updatedAt = String(formData.get('updated_at') || '')
    if (!fundoId || !updatedAt) return falha('Contexto do fundo invalido. Recarregue a pagina.')
    const parsed = validarEntrada(formData)
    if (!parsed.success) {
      return { success: false, message: 'Revise os campos informados.', fieldErrors: parsed.error.flatten().fieldErrors }
    }
    await autorizarEConsumirAcaoSensivel(context, 'atualizar_fundo_estrutural', String(formData.get('mfa_code') || ''))
    const { error } = await context.supabase.rpc('admin_atualizar_fundo', {
      p_fundo_id: fundoId,
      p_updated_at_esperado: updatedAt,
      ...argsEstruturais(parsed.data),
    })
    if (error) return mapearErro(error)
    revalidatePath('/admin/fundos')
    revalidatePath(`/admin/fundos/${fundoId}`)
    return { success: true, message: 'Dados estruturais atualizados.', data: { id: fundoId }, notification: { type: 'success', message: 'Dados estruturais atualizados.' } }
  } catch (error) {
    return mapearErro(error)
  }
}

export async function alterarStatusFundoAdmin(input: {
  fundoId: string
  updatedAt: string
  ativar: boolean
  mfaCode: string
}): Promise<AdminFundoActionResult> {
  try {
    const context = await requireSuperAdmin()
    if (!input.fundoId || !input.updatedAt) return falha('Contexto do fundo invalido. Recarregue a pagina.')
    await autorizarEConsumirAcaoSensivel(context, input.ativar ? 'ativar_fundo' : 'desativar_fundo', input.mfaCode)
    const rpc = input.ativar ? 'admin_ativar_fundo' : 'admin_desativar_fundo'
    const { error } = await context.supabase.rpc(rpc, { p_fundo_id: input.fundoId, p_updated_at_esperado: input.updatedAt })
    if (error) return mapearErro(error)
    revalidatePath('/admin')
    revalidatePath('/admin/fundos')
    revalidatePath(`/admin/fundos/${input.fundoId}`)
    return {
      success: true,
      message: input.ativar ? 'Fundo ativado.' : 'Fundo desativado.',
      data: { id: input.fundoId },
      notification: { type: 'success', message: input.ativar ? 'Fundo ativado.' : 'Fundo desativado.' },
    }
  } catch (error) {
    return mapearErro(error)
  }
}
