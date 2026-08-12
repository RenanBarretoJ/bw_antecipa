'use server'

import { redirect } from 'next/navigation'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireAuthenticated } from '@/lib/auth/authorization'
import { limparFluxoAutenticacao, marcarFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import {
  getCurrentUserOrThrow,
  obterEstadoMfaUsuario,
  registrarEventoSeguranca,
  registrarSessaoElevada,
  sanitizarCodigoTotp,
  substituirRecoveryCodes,
  usarRecoveryCode,
  validarFormatoCodigoTotp,
} from '@/lib/auth/mfa'
import { carregarAcessoPlataforma, resolverDestinoAposAutenticacao } from '@/lib/auth/platform-access'
import { registrarTentativaRateLimit, verificarRateLimit } from '@/lib/security/rate-limit'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'

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

type AdminMfaFactor = {
  id?: string
  status?: string
  factor_type?: string
  type?: string
}

type MfaClient = Awaited<ReturnType<typeof createClient>> & {
  auth: Awaited<ReturnType<typeof createClient>>['auth'] & {
    mfa: {
      enroll(input: { factorType: 'totp'; friendlyName?: string }): Promise<{ data: unknown; error: SupabaseMfaError | null }>
      challenge(input: { factorId: string }): Promise<{ data: { id: string } | null; error: SupabaseMfaError | null }>
      verify(input: { factorId: string; challengeId: string; code: string }): Promise<{ data: unknown; error: SupabaseMfaError | null }>
      listFactors(): Promise<{ data: { totp?: unknown[]; all?: unknown[] } | null; error: SupabaseMfaError | null }>
      unenroll(input: { factorId: string }): Promise<{ data: unknown; error: SupabaseMfaError | null }>
      getAuthenticatorAssuranceLevel(): Promise<{ data: { currentLevel: string | null; nextLevel: string | null } | null; error: SupabaseMfaError | null }>
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

function assertGestor(context: Awaited<ReturnType<typeof requireAuthenticated>>) {
  if (context.profile.role !== 'gestor') {
    throw new Error('Apenas gestores podem executar esta acao.')
  }
}

function validarMotivoResetMfa(motivo: string) {
  const value = motivo.trim()
  if (value.length < 10) throw new Error('Informe um motivo com pelo menos 10 caracteres.')
  return value
}

async function notificarUsuarioResetMfa(userId: string, titulo: string, mensagem: string, dedupeKey: string) {
  const { error } = await createAdminClient().from('notificacoes').insert({
    usuario_id: userId,
    titulo,
    mensagem,
    tipo: 'mfa_reset_administrativo',
    dedupe_key: dedupeKey,
  } as never)

  if (error) {
    console.warn('[mfa/reset-admin][notificacao]', {
      userId,
      dedupeKey,
      message: error.message,
    })
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
  await registrarSessaoElevada(user.id, 'totp', factorId, supabase)
  await createAdminClient().from('profiles').update({ mfa_ativado_em: new Date().toISOString() } as never).eq('id', user.id)
  await registrarEventoSeguranca({ tipo_evento: 'MFA_ATIVADO', usuario_id: user.id, ator_usuario_id: user.id })
  await registrarTentativaRateLimit({ escopo: 'mfa_totp', identifier: user.id, sucesso: true })
  return result('MFA ativado. Guarde os codigos de recuperacao agora.', true, { recoveryCodes })
}

export async function verificarDesafioMfa(_prevState: MfaActionState | undefined, formData: FormData): Promise<MfaActionState> {
  const { user, supabase } = await getCurrentUserOrThrow()
  const factorId = String(formData.get('factorId') || '')
  const code = sanitizarCodigoTotp(String(formData.get('code') || ''))
  const contexto = String(formData.get('contexto') || '')
  const isPasswordReset = contexto === 'password_reset'

  if (!factorId || !validarFormatoCodigoTotp(code)) return result('Codigo MFA invalido.')
  const limited = await verificarRateLimit({ escopo: 'mfa_totp', identifier: user.id, limite: 5 })
  if (!limited.allowed) return result('Muitas tentativas de MFA. Aguarde antes de tentar novamente.')

  const client = asMfaClient(supabase)
  const aalAntes = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  const challenge = await client.auth.mfa.challenge({ factorId })
  if (challenge.error || !challenge.data?.id) {
    await registrarTentativaRateLimit({ escopo: 'mfa_totp', identifier: user.id, sucesso: false })
    await registrarEventoSeguranca({ tipo_evento: 'MFA_LOGIN_FALHOU', usuario_id: user.id, ator_usuario_id: user.id, severidade: 'warning', dados: { etapa: 'challenge' } })
    return result('Nao foi possivel validar o MFA.')
  }

  const verified = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code })
  if (verified.error) {
    await registrarTentativaRateLimit({ escopo: 'mfa_totp', identifier: user.id, sucesso: false })
    await registrarEventoSeguranca({ tipo_evento: 'MFA_FALHA', usuario_id: user.id, ator_usuario_id: user.id, severidade: 'warning' })
    await registrarEventoSeguranca({ tipo_evento: 'MFA_LOGIN_FALHOU', usuario_id: user.id, ator_usuario_id: user.id, severidade: 'warning', dados: { etapa: 'verify' } })
    if (isPasswordReset) await registrarEventoSeguranca({ tipo_evento: 'MFA_FAILED_AFTER_PASSWORD_RESET', usuario_id: user.id, ator_usuario_id: user.id, severidade: 'warning' })
    return result('Codigo MFA invalido.')
  }

  await registrarSessaoElevada(user.id, 'totp', factorId, supabase)
  const aalDepois = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  await registrarTentativaRateLimit({ escopo: 'mfa_totp', identifier: user.id, sucesso: true })
  if (isPasswordReset) {
    await registrarEventoSeguranca({
      tipo_evento: 'MFA_VERIFIED_AFTER_PASSWORD_RESET',
      usuario_id: user.id,
      ator_usuario_id: user.id,
      dados: {
        aal_antes: aalAntes.data || null,
        aal_depois: aalDepois.data || null,
      },
    })
  }
  return result('Sessao elevada com sucesso.', true)
}

export async function usarCodigoRecuperacaoMfa(_prevState: MfaActionState | undefined, formData: FormData): Promise<MfaActionState> {
  const { user } = await getCurrentUserOrThrow()
  const code = String(formData.get('recoveryCode') || '').trim()
  const contexto = String(formData.get('contexto') || '')
  const isPasswordReset = contexto === 'password_reset'
  const limited = await verificarRateLimit({ escopo: 'mfa_recovery', identifier: user.id, limite: 5 })
  if (!limited.allowed) return result('Muitas tentativas de recuperacao. Aguarde antes de tentar novamente.')

  const ok = await usarRecoveryCode(user.id, code)
  await registrarTentativaRateLimit({ escopo: 'mfa_recovery', identifier: user.id, sucesso: ok })
  if (isPasswordReset) {
    await registrarEventoSeguranca({
      tipo_evento: ok ? 'MFA_VERIFIED_AFTER_PASSWORD_RESET' : 'MFA_FAILED_AFTER_PASSWORD_RESET',
      usuario_id: user.id,
      ator_usuario_id: user.id,
      severidade: ok ? 'info' : 'warning',
      dados: { metodo: 'recovery_code' },
    })
  }
  if (!ok) return result('Codigo de recuperacao invalido ou ja utilizado.')
  await marcarFluxoAutenticacao('mfa_recovery_temporary')
  await registrarEventoSeguranca({ tipo_evento: 'MFA_REENROLL_REQUIRED', usuario_id: user.id, ator_usuario_id: user.id, severidade: 'warning' })
  return result('Codigo de recuperacao aceito. Reconfigure o MFA antes de acessar o portal.', true)
}

export async function regenerarCodigosRecuperacao(mfaCode: string): Promise<MfaActionState<{ recoveryCodes: string[] }>> {
  const context = await requireAuthenticated()
  try {
    await autorizarEConsumirAcaoSensivel(context, 'regenerar_recovery_codes', mfaCode)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Não foi possível confirmar esta ação.')
  }
  const recoveryCodes = await substituirRecoveryCodes(context.user.id)
  await registrarEventoSeguranca({ tipo_evento: 'MFA_RECOVERY_REGENERADO', usuario_id: context.user.id, ator_usuario_id: context.user.id, severidade: 'warning' })
  return result('Novos codigos gerados. Eles serao exibidos somente agora.', true, { recoveryCodes })
}

export async function desativarMfaProprio(factorId: string): Promise<MfaActionState> {
  const context = await requireAuthenticated()
  await registrarEventoSeguranca({
    tipo_evento: 'ACESSO_NEGADO',
    usuario_id: context.user.id,
    ator_usuario_id: context.user.id,
    severidade: 'warning',
    dados: {
      motivo: 'tentativa_desativacao_mfa_obrigatorio',
      factor_id_informado: !!factorId,
    },
  })
  return result('MFA obrigatorio nao pode ser desativado pelo usuario.')
}

export async function solicitarResetMfaAdministrativo(usuarioId: string, motivo: string, evidencia?: string, mfaCode = ''): Promise<MfaActionState<{ solicitacaoId: string }>> {
  const context = await requireAuthenticated()
  assertGestor(context)
  try { await autorizarEConsumirAcaoSensivel(context, 'reset_mfa_administrativo', mfaCode) }
  catch (error) { return result(error instanceof Error ? error.message : 'Não foi possível confirmar esta ação.') }

  const motivoValidado = validarMotivoResetMfa(motivo)
  const admin = createAdminClient()

  const { data: usuario } = await admin
    .from('profiles')
    .select('id, email, role')
    .eq('id', usuarioId)
    .maybeSingle()

  if (!usuario) return result('Usuario alvo nao encontrado.')

  const { data: pendente } = await admin
    .from('mfa_reset_solicitacoes')
    .select('id')
    .eq('usuario_id', usuarioId)
    .eq('status', 'pendente')
    .maybeSingle()

  if (pendente) return result('Ja existe uma solicitacao de reset MFA pendente para este usuario.')

  const { data, error } = await admin
    .from('mfa_reset_solicitacoes')
    .insert({
      usuario_id: usuarioId,
      solicitante_id: context.user.id,
      motivo: motivoValidado,
      evidencia: evidencia?.trim() || null,
    } as never)
    .select('id')
    .single()

  if (error || !data) return result(`Nao foi possivel solicitar reset MFA: ${error?.message || 'erro desconhecido'}`)

  const solicitacaoId = (data as { id: string }).id
  await registrarEventoSeguranca({
    tipo_evento: 'MFA_RESET_ADMINISTRATIVO',
    usuario_id: usuarioId,
    ator_usuario_id: context.user.id,
    severidade: 'warning',
    entidade_tipo: 'mfa_reset_solicitacoes',
    entidade_id: solicitacaoId,
    dados: { etapa: 'solicitado', motivo: motivoValidado, evidencia: !!evidencia },
  })

  await notificarUsuarioResetMfa(
    usuarioId,
    'Reset de MFA solicitado',
    'Um gestor solicitou reset administrativo do seu MFA. A execucao depende de aprovacao de outro gestor.',
    `mfa-reset-solicitado:${solicitacaoId}`,
  )

  return result('Solicitacao de reset MFA criada. Outro gestor deve aprovar e executar.', true, { solicitacaoId })
}

export async function aprovarExecutarResetMfaAdministrativo(solicitacaoId: string, mfaCode = ''): Promise<MfaActionState> {
  const context = await requireAuthenticated()
  assertGestor(context)
  try { await autorizarEConsumirAcaoSensivel(context, 'reset_mfa_administrativo', mfaCode) }
  catch (error) { return result(error instanceof Error ? error.message : 'Não foi possível confirmar esta ação.') }

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data: solicitacao } = await admin
    .from('mfa_reset_solicitacoes')
    .select('*')
    .eq('id', solicitacaoId)
    .eq('status', 'pendente')
    .maybeSingle()

  if (!solicitacao) return result('Solicitacao pendente nao encontrada.')

  const reset = solicitacao as { usuario_id: string; solicitante_id: string; motivo: string }
  if (reset.solicitante_id === context.user.id) {
    return result('Aprovador deve ser um gestor diferente do solicitante.')
  }

  const { data: factorsData, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: reset.usuario_id })
  if (listError) {
    await admin.from('mfa_reset_solicitacoes').update({
      status: 'erro',
      aprovador_id: context.user.id,
      aprovado_em: now,
      erro_execucao: listError.message,
      updated_at: now,
    } as never).eq('id', solicitacaoId)
    return result(`Nao foi possivel listar fatores MFA: ${listError.message}`)
  }

  const factors = ((factorsData?.factors || []) as AdminMfaFactor[]).filter((factor) => !!factor.id)
  let removed = 0
  for (const factor of factors) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({ userId: reset.usuario_id, id: factor.id! })
    if (error) {
      await admin.from('mfa_reset_solicitacoes').update({
        status: 'erro',
        aprovador_id: context.user.id,
        aprovado_em: now,
        fatores_removidos: removed,
        erro_execucao: error.message,
        updated_at: now,
      } as never).eq('id', solicitacaoId)
      await registrarEventoSeguranca({
        tipo_evento: 'MFA_RESET_ADMINISTRATIVO',
        usuario_id: reset.usuario_id,
        ator_usuario_id: context.user.id,
        severidade: 'critical',
        entidade_tipo: 'mfa_reset_solicitacoes',
        entidade_id: solicitacaoId,
        dados: { etapa: 'erro', fator_id: factor.id, erro: error.message },
      })
      return result(`Reset MFA interrompido: ${error.message}`)
    }
    removed += 1
  }

  await Promise.all([
    admin.from('mfa_recovery_codes').update({ invalidado_em: now } as never).eq('user_id', reset.usuario_id).is('usado_em', null).is('invalidado_em', null),
    admin.from('sessoes_elevadas').delete().eq('user_id', reset.usuario_id),
    admin.from('profiles').update({ mfa_ativado_em: null, mfa_reset_em: now, sessoes_revogadas_em: now } as never).eq('id', reset.usuario_id),
    admin.from('mfa_reset_solicitacoes').update({
      status: 'executado',
      aprovador_id: context.user.id,
      aprovado_em: now,
      executado_em: now,
      fatores_removidos: removed,
      erro_execucao: null,
      updated_at: now,
    } as never).eq('id', solicitacaoId),
  ])

  await registrarEventoSeguranca({
    tipo_evento: 'MFA_RESET_ADMINISTRATIVO',
    usuario_id: reset.usuario_id,
    ator_usuario_id: context.user.id,
    severidade: 'critical',
    entidade_tipo: 'mfa_reset_solicitacoes',
    entidade_id: solicitacaoId,
    dados: { etapa: 'executado', fatores_removidos: removed, dupla_aprovacao: true },
  })

  await notificarUsuarioResetMfa(
    reset.usuario_id,
    'MFA resetado',
    'Seu MFA foi resetado administrativamente. No proximo login, configure um novo aplicativo autenticador.',
    `mfa-reset-executado:${solicitacaoId}`,
  )

  return result(`Reset MFA executado. Fatores removidos: ${removed}.`, true)
}

export async function rejeitarResetMfaAdministrativo(solicitacaoId: string, motivo: string, mfaCode = ''): Promise<MfaActionState> {
  const context = await requireAuthenticated()
  assertGestor(context)
  try { await autorizarEConsumirAcaoSensivel(context, 'reset_mfa_administrativo', mfaCode) }
  catch (error) { return result(error instanceof Error ? error.message : 'Não foi possível confirmar esta ação.') }

  const motivoValidado = validarMotivoResetMfa(motivo)
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data: solicitacao } = await admin
    .from('mfa_reset_solicitacoes')
    .select('usuario_id, solicitante_id')
    .eq('id', solicitacaoId)
    .eq('status', 'pendente')
    .maybeSingle()

  if (!solicitacao) return result('Solicitacao pendente nao encontrada.')

  const reset = solicitacao as { usuario_id: string; solicitante_id: string }
  if (reset.solicitante_id === context.user.id) {
    return result('Rejeicao deve ser feita por um gestor diferente do solicitante.')
  }

  const { error } = await admin.from('mfa_reset_solicitacoes').update({
    status: 'rejeitado',
    aprovador_id: context.user.id,
    aprovado_em: now,
    erro_execucao: motivoValidado,
    updated_at: now,
  } as never).eq('id', solicitacaoId)

  if (error) return result(`Nao foi possivel rejeitar reset MFA: ${error.message}`)

  await registrarEventoSeguranca({
    tipo_evento: 'MFA_RESET_ADMINISTRATIVO',
    usuario_id: reset.usuario_id,
    ator_usuario_id: context.user.id,
    severidade: 'warning',
    entidade_tipo: 'mfa_reset_solicitacoes',
    entidade_id: solicitacaoId,
    dados: { etapa: 'rejeitado', motivo: motivoValidado },
  })

  return result('Solicitacao de reset MFA rejeitada.', true)
}

export async function encerrarOutrasSessoes(mfaCode: string): Promise<MfaActionState> {
  const context = await requireAuthenticated()
  let authorization: Awaited<ReturnType<typeof autorizarEConsumirAcaoSensivel>>
  try { authorization = await autorizarEConsumirAcaoSensivel(context, 'encerrar_outras_sessoes', mfaCode) }
  catch (error) { return result(error instanceof Error ? error.message : 'Não foi possível confirmar esta ação.') }
  await context.supabase.auth.signOut({ scope: 'others' })
  const now = new Date().toISOString()
  if (authorization.sessionId) {
    await createAdminClient().from('sessoes_elevadas').update({ revogada_em: now, motivo_revogacao: 'encerrar_outras_sessoes', updated_at: now } as never).eq('user_id', context.user.id).neq('session_id', authorization.sessionId).is('revogada_em', null)
  }
  await createAdminClient().from('profiles').update({ sessoes_revogadas_em: new Date().toISOString() } as never).eq('id', context.user.id)
  await registrarEventoSeguranca({ tipo_evento: 'SESSOES_REVOGADAS', usuario_id: context.user.id, ator_usuario_id: context.user.id, severidade: 'warning' })
  return result('Outras sessoes encerradas.', true)
}

export async function listarFatoresMfa(): Promise<MfaActionState<{ fatores: Array<{ id: string; friendlyName: string; status: string }>; estado: Awaited<ReturnType<typeof obterEstadoMfaUsuario>> }>> {
  // O desafio TOTP começa em AAL1 e precisa conhecer o fator antes de elevar a
  // sessão. Esta exceção permite somente a leitura dos fatores do próprio
  // usuário; ações operacionais e sensíveis continuam no gate MFA padrão.
  const context = await requireAuthenticated(undefined, { allowMfaPending: true })
  const { data, error } = await asMfaClient(context.supabase).auth.mfa.listFactors()
  if (error) return result('Nao foi possivel listar fatores MFA.')
  const estado = await obterEstadoMfaUsuario(context.supabase)
  const fatores = (data?.totp || []).map(parseFactor).filter((factor) => factor.id && factor.status === 'verified')
  return result('Fatores carregados.', true, { fatores, estado })
}

function normalizarNextAposMfa(next?: string | FormData | null) {
  if (next instanceof FormData) return null
  if (!next) return null
  if (next === '/redefinir-senha') return next
  return null
}

export async function redirecionarAposMfa(next?: string | FormData | null) {
  const context = await requireAuthenticated()
  await limparFluxoAutenticacao()
  const explicitNext = normalizarNextAposMfa(next)
  if (explicitNext) redirect(explicitNext)
  const access = await carregarAcessoPlataforma(context.supabase, context.user.id, context.profile.role)
  redirect(resolverDestinoAposAutenticacao(access))
}
