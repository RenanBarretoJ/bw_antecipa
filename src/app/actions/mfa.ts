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

type MfaClient = Awaited<ReturnType<typeof createClient>> & {
  auth: Awaited<ReturnType<typeof createClient>>['auth'] & {
    mfa: {
      enroll(input: { factorType: 'totp'; friendlyName?: string }): Promise<{ data: unknown; error: { message: string } | null }>
      challenge(input: { factorId: string }): Promise<{ data: { id: string } | null; error: { message: string } | null }>
      verify(input: { factorId: string; challengeId: string; code: string }): Promise<{ data: unknown; error: { message: string } | null }>
      listFactors(): Promise<{ data: { totp?: unknown[] } | null; error: { message: string } | null }>
      unenroll(input: { factorId: string }): Promise<{ data: unknown; error: { message: string } | null }>
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
  }
}

export async function iniciarConfiguracaoMfa(): Promise<MfaActionState<{ factorId: string; qrCode: string; secret: string; uri: string }>> {
  const { user, supabase } = await getCurrentUserOrThrow()
  const limited = await verificarRateLimit({ escopo: 'mfa_totp', identifier: user.id, limite: 5 })
  if (!limited.allowed) return result('Muitas tentativas. Aguarde antes de tentar novamente.')

  const { data, error } = await asMfaClient(supabase).auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'BW Antecipa',
  })

  if (error) {
    await registrarTentativaRateLimit({ escopo: 'mfa_totp', identifier: user.id, sucesso: false })
    return result('Nao foi possivel iniciar a configuracao do MFA.')
  }

  await registrarEventoSeguranca({ tipo_evento: 'MFA_ENROLL_INICIADO', usuario_id: user.id, ator_usuario_id: user.id })
  await registrarTentativaRateLimit({ escopo: 'mfa_totp', identifier: user.id, sucesso: true })
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
