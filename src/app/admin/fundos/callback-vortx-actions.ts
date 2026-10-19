'use server'

import { z } from 'zod'
import { AuthorizationError } from '@/lib/auth/authorization'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import { carregarContextoRelatorios } from '@/lib/integracoes/vortx/relatorios-contexto.server'
import { callbackActionSchema, callbackStatusSchema, type CallbackAdminResult } from '@/lib/integracoes/vortx/callback-admin'
import { montarUrlCallback, prontidaoCallback } from '@/lib/integracoes/vortx/callback-admin.server'
import { gerarSegredoCallback } from '@/lib/integracoes/vortx/relatorios-callback'

const readSchema = z.object({ fundoId: z.uuid(), versaoId: z.uuid() }).strict()
function failure(error: unknown): CallbackAdminResult {
  if (error instanceof AuthorizationError) return { success: false, message: error.message }
  if (error && typeof error === 'object' && 'code' in error && error.code === '40001') {
    return { success: false, message: 'O callback foi alterado em outra sessão. Atualize os dados antes de continuar.' }
  }
  return { success: false, message: 'Não foi possível concluir esta ação. Atualize o estado do callback antes de tentar novamente; nenhuma URL é recuperada após fechar a exibição.' }
}
async function contexto(input: { fundoId: string; versaoId: string }) {
  const value = await carregarContextoRelatorios(input.fundoId)
  if (!value.contexto.versoes.some(v => v.id === input.versaoId)) throw new AuthorizationError('Selecione uma versão Vórtx VRS 2.0 publicada deste Fundo.', 'FORBIDDEN')
  return value
}
export async function obterCallbackVortx(input: unknown): Promise<CallbackAdminResult> {
  try {
    const parsed = readSchema.safeParse(input)
    if (!parsed.success) return { success: false, message: 'Selecione o Fundo e a integração publicada.' }
    const { auth } = await contexto(parsed.data)
    const { data, error } = await auth.supabase.rpc('admin_vortx_callback_status', { p_fundo_id: parsed.data.fundoId, p_versao_id: parsed.data.versaoId })
    if (error) throw error
    return { success: true, message: 'Estado atualizado.', status: callbackStatusSchema.parse(data), ...prontidaoCallback() }
  } catch (error) { return failure(error) }
}
export async function alterarCallbackVortx(input: unknown): Promise<CallbackAdminResult> {
  try {
    const parsed = callbackActionSchema.safeParse(input)
    if (!parsed.success) return { success: false, message: 'Revise a ação e informe o código TOTP de seis dígitos.' }
    const form = parsed.data
    const { auth } = await contexto(form)
    const readiness = prontidaoCallback()
    if (!readiness.habilitado && form.acao !== 'revogar') return { success: false, message: readiness.bloqueio! }
    const secret = form.acao === 'gerar' || form.acao === 'rotacionar' ? gerarSegredoCallback() : null
    // Validate the origin before mutation, so a bad setting never consumes a credential rotation.
    if (secret) montarUrlCallback('00000000-0000-4000-8000-000000000000', secret.segredo)
    const authorization = await autorizarEConsumirAcaoSensivel(auth, 'configurar_credencial_vortx_vrs', form.mfaCode, { consumoTransacional: true })
    if (!('nonceHash' in authorization) || !authorization.nonceHash) throw new Error('MISSING_NONCE')
    const { data, error } = await auth.supabase.rpc('admin_vortx_callback_mutar', { p_fundo_id: form.fundoId, p_versao_id: form.versaoId,
      p_acao: form.acao, p_revisao_esperada: form.revisao, p_segredo_hash: secret?.hash ?? null, p_nonce_hash: authorization.nonceHash })
    if (error) throw error
    const status = callbackStatusSchema.parse(data)
    if (secret && !status.id) throw new Error('MISSING_ENDPOINT')
    return { success: true, status, ...readiness,
      message: form.acao === 'revogar' ? 'Recebimento revogado.' : form.acao === 'informar_cadastro' ? 'Cadastro informado. A confirmação técnica depende do recebimento de um evento.' : 'URL gerada. Copie e encaminhe à Vórtx por canal privado.',
      ...(secret && status.id ? { urlUnica: montarUrlCallback(status.id, secret.segredo) } : {}) }
  } catch (error) { return failure(error) }
}
