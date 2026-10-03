'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import { criptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import { createAdminClient } from '@/lib/supabase/server'
import { IntakeError } from '@/lib/email-intake/contracts'
import { testEmailMailbox } from '@/lib/email-intake/operations/credentials.server'
import { refreshEmailMetadata } from '@/lib/email-intake/operations/metadata.server'
import { requireEmailOperator, operatorError } from '@/lib/email-intake/operations/operator.server'
import { emailConfigurationSchema, credentialInputSchema, emailDashboardSchema, cedenteOptionsSchema,
  inboxFilterSchema, inboxSchema, messageSchema, type OperatorResult } from '@/lib/email-intake/operations/contracts'

function refresh() {
  revalidatePath('/gestor/integracoes-email')
  revalidatePath('/admin/integracoes-email')
}

export async function carregarOperacaoEmail(fundoId: string, integrationId?: string) {
  const context = await requireEmailOperator()
  const result = await context.supabase.rpc('email_operator_dashboard', {
    p_fundo: z.uuid().parse(fundoId), ...(integrationId ? { p_id: z.uuid().parse(integrationId) } : {}),
  })
  if (result.error) throw new Error(operatorError(result.error))
  return emailDashboardSchema.parse(result.data)
}

export async function buscarCedentesEmail(fundoId: string, search = '', page = 1) {
  const context = await requireEmailOperator()
  const result = await context.supabase.rpc('email_operator_cedentes', { p_fundo: z.uuid().parse(fundoId),
    p_search: z.string().max(100).parse(search), p_page: z.number().int().min(1).max(10000).parse(page) })
  if (result.error) throw new Error(operatorError(result.error))
  return cedenteOptionsSchema.parse(result.data)
}

export async function carregarInboxEmail(fundoId: string, filter: unknown) {
  const context = await requireEmailOperator()
  const result = await context.supabase.rpc('email_operator_inbox', { p_fundo: z.uuid().parse(fundoId), p_filter: inboxFilterSchema.parse(filter) })
  if (result.error) throw new Error(operatorError(result.error))
  return inboxSchema.parse(result.data)
}

export async function carregarMensagemEmail(fundoId: string, messageId: string, page = 1) {
  const context = await requireEmailOperator()
  const result = await context.supabase.rpc('email_operator_message', { p_fundo: z.uuid().parse(fundoId),
    p_message: z.uuid().parse(messageId), p_page: z.number().int().min(1).max(1000).parse(page) })
  if (result.error) throw new Error(operatorError(result.error))
  return messageSchema.parse(result.data)
}

export async function atualizarDetalhesMensagensEmail(input: unknown): Promise<OperatorResult<{ updated: number; failed: number }>> {
  const parsed = z.object({ fundoId: z.uuid(), ids: z.array(z.uuid()).min(1).max(50) }).safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Reabra a página para consultar os detalhes das mensagens exibidas.' }
  try {
    const context = await requireEmailOperator()
    const lease = await context.supabase.rpc('email_operator_begin_metadata', { p_fundo: parsed.data.fundoId, p_ids: parsed.data.ids })
    if (lease.error) throw lease.error
    const result = await refreshEmailMetadata(parsed.data.fundoId, z.uuid().parse(lease.data))
    refresh()
    return { ok: true, data: result }
  } catch (error) { return { ok: false, message: operatorError(error) } }
}

const saveSchema = z.object({ fundoId: z.uuid(), id: z.uuid().nullable(), revision: z.number().int().positive().nullable(),
  config: emailConfigurationSchema, mfaCode: z.string().regex(/^\d{6}$/), requestId: z.uuid() })
export async function salvarIntegracaoEmail(input: unknown): Promise<OperatorResult<{ id: string }>> {
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Confira os campos e informe o código MFA de seis dígitos. Seus dados foram preservados.' }
  try {
    const context = await requireEmailOperator()
    await autorizarEConsumirAcaoSensivel(context, 'criar_integracao_versao', parsed.data.mfaCode)
    const { fundoId, id, revision, config } = parsed.data
    const result = await context.supabase.rpc('email_operator_save', { p_fundo: fundoId, p_id: id, p_revision: revision, p_config: { ...config, requestId: parsed.data.requestId } })
    if (result.error) throw result.error
    refresh()
    return { ok: true, data: { id: z.uuid().parse(result.data) } }
  } catch (error) { return { ok: false, message: operatorError(error) } }
}

export async function criarCredencialEmail(input: unknown): Promise<OperatorResult<{ id: string }>> {
  const parsed = credentialInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Confira os identificadores da aplicação, o segredo e o código MFA.' }
  try {
    const context = await requireEmailOperator()
    if (context.profile.role !== 'super_admin') return { ok: false, message: 'Peça ao administrador técnico para cadastrar a credencial deste fundo. Você pode salvar a integração como rascunho.' }
    const values = parsed.data
    await autorizarEConsumirAcaoSensivel(context, 'cadastrar_credencial_integracao', values.mfaCode)
    const identity = criptografarPortalFidcValor(JSON.stringify({ tenantId: values.tenantId, clientId: values.clientId }))
    const secret = criptografarPortalFidcValor(values.clientSecret)
    const result = await context.supabase.rpc('email_operator_create_credential', { p_fundo: values.fundoId, p_name: values.name,
      p_environment: values.environment, p_identity_cipher: identity.ciphertext, p_secret_cipher: secret.ciphertext, p_key_version: identity.chaveVersao, p_request: values.requestId })
    if (result.error) throw result.error
    refresh()
    return { ok: true, data: { id: z.uuid().parse(result.data) } }
  } catch (error) { return { ok: false, message: operatorError(error) } }
}

const commandSchema = z.object({ fundoId: z.uuid(), id: z.uuid(), revision: z.number().int().positive(), mfaCode: z.string().regex(/^\d{6}$/) })
export async function testarIntegracaoEmail(input: unknown): Promise<OperatorResult<{ testedAt: string }>> {
  const parsed = commandSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Informe o código MFA de seis dígitos para testar esta configuração.' }
  try {
    const context = await requireEmailOperator(), value = parsed.data
    await autorizarEConsumirAcaoSensivel(context, 'testar_integracao', value.mfaCode)
    // Authenticated RPC authorizes the integration and leases this test before any service credential access.
    const begun = await context.supabase.rpc('email_operator_begin_test', { p_id: value.id, p_revision: value.revision })
    if (begun.error) throw begun.error
    const token = z.uuid().parse(begun.data)
    let tenant: string | null = null, failure: string | null = null
    try { tenant = await testEmailMailbox(value.id, value.fundoId) }
    catch (error) { failure = error instanceof IntakeError && ['CONFIGURATION', 'AUTHENTICATION', 'ACCESS_DENIED', 'NOT_FOUND', 'THROTTLED', 'PROVIDER_UNAVAILABLE', 'INVALID_RESPONSE'].includes(error.code) ? error.code : 'CONFIGURATION' }
    const completed = await createAdminClient().rpc('email_operator_complete_test', { p_id: value.id, p_token: token, p_tenant: tenant, p_error: failure })
    if (completed.error) throw completed.error
    refresh()
    if (failure) throw new IntakeError(failure === 'ACCESS_DENIED' ? 'ACCESS_DENIED' : failure === 'AUTHENTICATION' ? 'AUTHENTICATION' : 'CONFIGURATION')
    return { ok: true, data: { testedAt: new Date().toISOString() } }
  } catch (error) { return { ok: false, message: operatorError(error) } }
}

export async function alterarAtivacaoEmail(input: unknown): Promise<OperatorResult<null>> {
  const parsed = commandSchema.extend({ enabled: z.boolean(), scopeConfirmed: z.boolean() }).safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Confira a confirmação de ativação e o código MFA.' }
  try {
    const context = await requireEmailOperator(), value = parsed.data
    await autorizarEConsumirAcaoSensivel(context, value.enabled ? 'publicar_integracao' : 'desativar_integracao', value.mfaCode)
    const result = await context.supabase.rpc('email_operator_set_enabled', { p_id: value.id, p_revision: value.revision,
      p_enabled: value.enabled, p_scope_confirmed: value.scopeConfirmed })
    if (result.error) throw result.error
    refresh()
    return { ok: true, data: null }
  } catch (error) { return { ok: false, message: operatorError(error) } }
}
