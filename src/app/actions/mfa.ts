'use server'

import { redirect } from 'next/navigation'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireAuthenticated } from '@/lib/auth/authorization'
import {
  exigirSessaoElevada,
  getCurrentUserOrThrow,
  obterEstadoMfaUsuario,
  registrarEventoSeguranca,
  registrarSessaoElevada,
  sanitizarCodigoTotp,
  substituirRecoveryCodes,
  usarRecoveryCode,
  validarFormatoCodigoTotp,
} from '@/lib/auth/mfa'
import { requireRoleRedirect } from '@/lib/auth/role-routing'
import { registrarTentativaRateLimit, verificarRateLimit } from '@/lib/security/rate-limit'

export type MfaActionState<T = unknown> = {
  success: boolean
  message: string
  data?: T
}

type SupabaseMfaError = {
  message: string
  code?: string
  status?: number
}

type MfaClient = Awaited<ReturnType<typeof createClient>> & {
  auth: Awaited<ReturnType<typeof createClient>>['auth'] & {
    mfa: {
      enroll(input: { factorType: 'totp'; friendlyName?: string }): Promise<{ data: unknown; error: SupabaseMfaError | null }>
      challenge(input: { factorId: string }): Promise<{ data: { id: string } | null; error: SupabaseMfaError | null }>
      verify(input: { factorId: string; challengeId: string; code: string }): Promise<{ data: unknown; error: SupabaseMfaError | null }>
      listFactors(): Promise<{ data: { totp?: unknown[]; all?: unknown[] } | null; error: SupabaseMfaError | null }>
      unenroll(input: { factorId: string }): Promise<{ data: unknown; error: SupabaseMfaError | null }>
    }
  }
}

function asMfaClient(client: Awaited<ReturnType<typeof createClient>>): MfaClient {
  return client as MfaClient
}

function result<T>(message: string, success = false, data?: T): MfaActionState<T> {
  return { success, message, data }
}

function parseEnrollment(data: unknown) {
  const value = data as { id?: string; totp?: { qr_code?: string; secret?: string; uri?: string } }
  return {
    factorId: value.id || '',
    qrCode: value.totp?.qr_code || '',
    secret: value.totp?.secret || '',
    uri: value.totp?.uri || '',
  }
}

function parseFactor(factor: unknown) {
  const value = factor as Record<string, unknown>
  return {
    id: String(value.id || ''),
    friendlyName: typeof value.friendly_name === 'string' ? value.friendly_name : 'Autenticador',
    status: typeof value.status === 'string' ? value.status : '',
    factorType: typeof value.factor_type === 'string' ? value.factor_type : typeof value.type === 'string' ? value.type : '',
  }
}

async function removerFatoresTotpPendentes(client: MfaClient) {
  const { data, error } = await client.auth.mfa.listFactors()
  if (error) {
    console.error('[mfa/setup][listFactors]', { message: error.message, code: error.code, status: error.status })
    return
  }

  const candidatos = [...(data?.totp || []), ...(data?.all || [])]
    .map(parseFactor)
    .filter((factor, index, list) => (
      factor.id &&
      factor.status !== 'verified' &&
      (!factor.factorType || factor.factorType === 'totp') &&
      list.findIndex((item) => item.id === factor.id) === index
    ))

  for (const factor of candidatos) {
    const { error: unenrollError } = await client.auth.mfa.unenroll({ factorId: factor.id })
    if (unenrollError) {
      console.error('[mfa/setup][unenroll-pending-factor]', {
        factorId: factor.id,
        message: unenrollError.message,
        code: unenrollError.code,
        status: unenrollError.status,
      })
    }
  }
}

async function criarFatorTotp(client: MfaClient) {
  return client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `BW Antecipa ${new Date().toISOString()}`,
  })
}

export async function iniciarConfiguracaoMfa(): Promise<MfaActionState<{ factorId: string; qrCode: string; secret: string; uri: string }>> {
  const { user, supabase } = await getCurrentUserOrThrow()
  const limited = await verificarRateLimit({ escopo: 'mfa_setup', identifier: user.id, limite: 20, janelaMs: 10 * 60 * 1000, bloqueioMs: 5 * 60 * 1000 })
  if (!limited.allowed) return result('Muitas tentativas. Aguarde antes de tentar novamente.')

  const client = asMfaClient(supabase)
  await removerFatoresTotpPendentes(client)

  let { data, error } = await criarFatorTotp(client)

  if (error && ['mfa_factor_name_conflict', 'too_many_enrolled_mfa_factors', 'conflict'].includes(error.code || '')) {
    await removerFatoresTotpPendentes(client)
    const retry = await criarFatorTotp(client)
    data = retry.data
    error = retry.error
  }

  if (error) {
    await registrarTentativaRateLimit({ escopo: 'mfa_setup', identifier: user.id, sucesso: false })
    console.error('[mfa/setup][enroll]', { userId: user.id, message: error.message, code: error.code, status: error.status })
    if (error.code === 'mfa_totp_enroll_not_enabled') return result('MFA TOTP nao esta habilitado no Supabase Auth deste projeto.')
    if (error.code === 'too_many_enrolled_mfa_factors') return result('Ha muitos fatores MFA pendentes. Remova fatores antigos e tente novamente.')
    return result('Nao foi possivel iniciar a configuracao do MFA. Tente sair e entrar novamente.')
  }

  await registrarEventoSeguranca({ tipo_evento: 'MFA_ENROLL_INICIADO', usuario_id: user.id, ator_usuario_id: user.id })
  await registrarTentativaRateLimit({ escopo: 'mfa_setup', identifier: user.id, sucesso: true })
  return result('Escaneie o QR Code no seu aplicativo autenticador.', true, parseEnrollment(data))
}

export async function confirmarConfiguracaoMfa(_prevState: MfaActionState<{ recoveryCodes: string[] }> | undefined, formData: FormData): Promise<MfaActionState<{ recoveryCodes: string[] }>> {
  const { user, supabase } = await getCurrentUserOrThrow()
  const factorId = String(formData.get('factorId') || '')
  const code = sanitizarCodigoTotp(String(formData.get('code') || ''))

  if (!factorId || !validarFormatoCodigoTotp(code)) return result('Codigo MFA invalido.')
  const limited = await verificarRateLimit({ escopo: 'mfa_totp', identifier: user.id, limite: 5 })
  if (!limited.allowed) return result('Muitas tentativas de MFA. Aguarde antes de tentar novamente.')

  const client = asMfaClient(supabase)
  const challenge = await client.auth.mfa.challenge({ factorId })
  if (challenge.error || !challenge.data?.id) {
    await registrarTentativaRateLimit({ escopo: 'mfa_totp', identifier: user.id, sucesso: false })
    return result('Nao foi possivel validar o fator MFA.')
  }

  const verified = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code })
  if (verified.error) {
    await registrarTentativaRateLimit({ escopo: 'mfa_totp', identifier: user.id, sucesso: false })
    await registrarEventoSeguranca({ tipo_evento: 'MFA_FALHA', usuario_id: user.id, ator_usuario_id: user.id, severidade: 'warning' })
    return result('Codigo MFA invalido.')
  }

  const recoveryCodes = await substituirRecoveryCodes(user.id)
  await registrarSessaoElevada(user.id, 'totp', factorId)
  await createAdminClient().from('profiles').update({ mfa_ativado_em: new Date().toISOString() } as never).eq('id', user.id)
  await registrarEventoSeguranca({ tipo_evento: 'MFA_ATIVADO', usuario_id: user.id, ator_usuario_id: user.id })
  await registrarTentativaRateLimit({ escopo: 'mfa_totp', identifier: user.id, sucesso: true })
  return result('MFA ativado. Guarde os codigos de recuperacao agora.', true, { recoveryCodes })
}

export async function verificarDesafioMfa(_prevState: MfaActionState | undefined, formData: FormData): Promise<MfaActionState> {
  const { user, supabase } = await getCurrentUserOrThrow()
  const factorId = String(formData.get('factorId') || '')
  const code = sanitizarCodigoTotp(String(formData.get('code') || ''))

  if (!factorId || !validarFormatoCodigoTotp(code)) return result('Codigo MFA invalido.')
  const limited = await verificarRateLimit({ escopo: 'mfa_totp', identifier: user.id, limite: 5 })
  if (!limited.allowed) return result('Muitas tentativas de MFA. Aguarde antes de tentar novamente.')

  const client = asMfaClient(supabase)
  const challenge = await client.auth.mfa.challenge({ factorId })
  if (challenge.error || !challenge.data?.id) {
    await registrarTentativaRateLimit({ escopo: 'mfa_totp', identifier: user.id, sucesso: false })
    return result('Nao foi possivel validar o MFA.')
  }

  const verified = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code })
  if (verified.error) {
    await registrarTentativaRateLimit({ escopo: 'mfa_totp', identifier: user.id, sucesso: false })
    await registrarEventoSeguranca({ tipo_evento: 'MFA_FALHA', usuario_id: user.id, ator_usuario_id: user.id, severidade: 'warning' })
    return result('Codigo MFA invalido.')
  }

  await registrarSessaoElevada(user.id, 'totp', factorId)
  await registrarTentativaRateLimit({ escopo: 'mfa_totp', identifier: user.id, sucesso: true })
  return result('Sessao elevada com sucesso.', true)
}

export async function usarCodigoRecuperacaoMfa(_prevState: MfaActionState | undefined, formData: FormData): Promise<MfaActionState> {
  const { user } = await getCurrentUserOrThrow()
  const code = String(formData.get('recoveryCode') || '').trim()
  const limited = await verificarRateLimit({ escopo: 'mfa_recovery', identifier: user.id, limite: 5 })
  if (!limited.allowed) return result('Muitas tentativas de recuperacao. Aguarde antes de tentar novamente.')

  const ok = await usarRecoveryCode(user.id, code)
  await registrarTentativaRateLimit({ escopo: 'mfa_recovery', identifier: user.id, sucesso: ok })
  if (!ok) return result('Codigo de recuperacao invalido ou ja utilizado.')
  return result('Codigo de recuperacao aceito. Sessao elevada.', true)
}

export async function regenerarCodigosRecuperacao(): Promise<MfaActionState<{ recoveryCodes: string[] }>> {
  const context = await requireAuthenticated()
  await exigirSessaoElevada(context)
  const recoveryCodes = await substituirRecoveryCodes(context.user.id)
  await registrarEventoSeguranca({ tipo_evento: 'MFA_RECOVERY_REGENERADO', usuario_id: context.user.id, ator_usuario_id: context.user.id, severidade: 'warning' })
  return result('Novos codigos gerados. Eles serao exibidos somente agora.', true, { recoveryCodes })
}

export async function desativarMfaProprio(factorId: string): Promise<MfaActionState> {
  const context = await requireAuthenticated()
  await exigirSessaoElevada(context)

  const { error } = await asMfaClient(context.supabase).auth.mfa.unenroll({ factorId })
  if (error) return result('Nao foi possivel desativar o MFA.')

  await createAdminClient().from('profiles').update({ mfa_ativado_em: null, mfa_reset_em: new Date().toISOString() } as never).eq('id', context.user.id)
  await registrarEventoSeguranca({ tipo_evento: 'MFA_DESATIVADO', usuario_id: context.user.id, ator_usuario_id: context.user.id, severidade: 'warning' })
  return result('MFA desativado.', true)
}

export async function encerrarOutrasSessoes(): Promise<MfaActionState> {
  const context = await requireAuthenticated()
  await exigirSessaoElevada(context)
  await context.supabase.auth.signOut({ scope: 'others' })
  await createAdminClient().from('profiles').update({ sessoes_revogadas_em: new Date().toISOString() } as never).eq('id', context.user.id)
  await registrarEventoSeguranca({ tipo_evento: 'SESSOES_REVOGADAS', usuario_id: context.user.id, ator_usuario_id: context.user.id, severidade: 'warning' })
  return result('Outras sessoes encerradas.', true)
}

export async function listarFatoresMfa(): Promise<MfaActionState<{ fatores: Array<{ id: string; friendlyName: string; status: string }>; estado: Awaited<ReturnType<typeof obterEstadoMfaUsuario>> }>> {
  const context = await requireAuthenticated()
  const { data, error } = await asMfaClient(context.supabase).auth.mfa.listFactors()
  if (error) return result('Nao foi possivel listar fatores MFA.')
  const estado = await obterEstadoMfaUsuario(context.supabase)
  const fatores = (data?.totp || []).map(parseFactor).filter((factor) => factor.id && factor.status === 'verified')
  return result('Fatores carregados.', true, { fatores, estado })
}

export async function redirecionarAposMfa() {
  const context = await requireAuthenticated()
  redirect(requireRoleRedirect(context.profile.role))
}
