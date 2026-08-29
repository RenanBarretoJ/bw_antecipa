'use server'

import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireAuthenticated } from '@/lib/auth/authorization'
import { exigirSessaoOperacionalAal2, hashSeguranca, obterEstadoMfaUsuario, registrarEventoSeguranca } from '@/lib/auth/mfa'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import { requireRoleRedirect } from '@/lib/auth/role-routing'
import { avaliarForcaSenha, criarAtributosUpdateSenha, validarNovaSenha } from '@/lib/auth/password'
import { limparFluxoAutenticacao, marcarFluxoAutenticacao, obterFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import { registrarTentativaRateLimit, verificarRateLimit } from '@/lib/security/rate-limit'
import { emailTemplates, enviarEmail } from '@/lib/email'
import type { Database } from '@/types/database'

const RESET_GENERIC_MESSAGE = 'Se existir uma conta para este e-mail, voce recebera instrucoes para redefinir sua senha.'

export type PasswordActionState = {
  success: boolean
  message: string
  errors?: Record<string, string[]>
  redirectTo?: string
  requiresMfa?: boolean
  notification?: {
    type?: 'success' | 'error' | 'warning' | 'info'
    title?: string
    message?: string
    details?: string
  }
}

type SupabaseAuthError = {
  message?: string
  code?: string
  status?: number
}

type RequestAuditContext = {
  ipHash: string | null
  userAgentHash: string | null
  ipAproximado: string
  navegador: string
  origin: string
  correlationId: string
}

function fieldErrors(errors: Record<string, string[]>): PasswordActionState {
  return { success: false, message: 'Revise os campos informados.', errors, notification: { type: 'warning', message: 'Revise os campos informados.' } }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function isAal2Error(error: SupabaseAuthError | null | undefined) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase()
  return text.includes('aal2') || text.includes('assurance') || text.includes('mfa') || text.includes('reauthentication')
}

function dashboardForRole(role: string | null | undefined) {
  return requireRoleRedirect((role || 'cedente') as never)
}

function maskIp(ip: string) {
  const value = ip.split(',')[0]?.trim() || 'Nao informado'
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    const parts = value.split('.')
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`
  }
  if (value.includes(':')) return `${value.slice(0, 16)}…`
  return value
}

async function requestAuditContext(): Promise<RequestAuditContext> {
  const h = await headers()
  const forwardedFor = h.get('x-forwarded-for') || h.get('x-real-ip') || ''
  const userAgent = h.get('user-agent') || ''
  const proto = h.get('x-forwarded-proto') || 'http'
  const host = h.get('host') || 'localhost:3000'
  const origin = h.get('origin') || `${proto}://${host}`
  const correlationId = h.get('x-correlation-id') || randomUUID()

  return {
    ipHash: forwardedFor ? hashSeguranca(forwardedFor) : null,
    userAgentHash: userAgent ? hashSeguranca(userAgent) : null,
    ipAproximado: forwardedFor ? maskIp(forwardedFor) : 'Nao informado',
    navegador: userAgent ? userAgent.slice(0, 160) : 'Nao informado',
    origin,
    correlationId,
  }
}

async function carregarProfilePorEmail(email: string) {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('id, email, nome_completo, role')
    .ilike('email', email)
    .maybeSingle()

  return data as { id: string; email: string; nome_completo: string; role: string } | null
}

async function reautenticarSenhaAtual(email: string, currentPassword: string) {
  const authClient = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )

  const { error } = await authClient.auth.signInWithPassword({
    email,
    password: currentPassword,
  })

  await authClient.auth.signOut({ scope: 'local' }).catch(() => undefined)
  return !error
}

async function notificarSenhaAlterada(input: {
  userId: string
  email: string
  nome: string
  audit: RequestAuditContext
  origem: 'reset' | 'authenticated_change'
}) {
  const now = new Date()
  const dataHora = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const template = emailTemplates.senhaAlterada(input.nome, dataHora, input.audit.navegador, input.audit.ipAproximado)

  await Promise.allSettled([
    enviarEmail({ to: input.email, subject: template.subject, html: template.html }),
    createAdminClient().from('notificacoes').insert({
      usuario_id: input.userId,
      titulo: 'Senha alterada',
      mensagem: 'Sua senha de acesso foi alterada. Se nao foi voce, contate imediatamente a equipe Better With.',
      tipo: 'seguranca_senha_alterada',
      dedupe_key: `senha-alterada:${input.userId}:${now.toISOString().slice(0, 16)}`,
    } as never),
  ])
}

async function registrarEventoSenha(input: {
  tipo: Parameters<typeof registrarEventoSeguranca>[0]['tipo_evento']
  userId?: string | null
  severidade?: 'info' | 'warning' | 'critical'
  audit: RequestAuditContext
  dados?: Record<string, unknown>
}) {
  await registrarEventoSeguranca({
    tipo_evento: input.tipo,
    usuario_id: input.userId || null,
    ator_usuario_id: input.userId || null,
    ator_tipo: input.userId ? 'usuario' : 'sistema',
    origem: 'password_flow',
    severidade: input.severidade || 'info',
    ip_hash: input.audit.ipHash,
    user_agent_hash: input.audit.userAgentHash,
    correlation_id: input.audit.correlationId,
    dados: input.dados || {},
  })
}

export async function solicitarRedefinicaoSenha(_prevState: PasswordActionState | undefined, formData: FormData): Promise<PasswordActionState> {
  const audit = await requestAuditContext()
  const email = normalizeEmail(String(formData.get('email') || ''))
  const supabase = await createClient()

  await Promise.allSettled([
    supabase.auth.signOut({ scope: 'local' }),
    limparFluxoAutenticacao(),
  ])

  if (!email || !email.includes('@')) {
    return { success: true, message: RESET_GENERIC_MESSAGE, notification: { type: 'success', message: RESET_GENERIC_MESSAGE } }
  }

  const identifier = `${email}:${audit.ipHash || 'sem-ip'}`
  const limited = await verificarRateLimit({ escopo: 'password_reset', identifier, limite: 4, janelaMs: 60 * 60 * 1000, bloqueioMs: 60 * 60 * 1000 })
  if (!limited.allowed) {
    return { success: true, message: RESET_GENERIC_MESSAGE, notification: { type: 'success', message: RESET_GENERIC_MESSAGE } }
  }

  const profile = await carregarProfilePorEmail(email)
  const redirectTo = `${audit.origin}/redefinir-senha`
  await registrarEventoSenha({ tipo: 'PASSWORD_RESET_REQUESTED', userId: profile?.id, audit, dados: { email_hash: hashSeguranca(email), email_existe: !!profile, redirect_to_path: '/redefinir-senha' } })

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  })

  await registrarTentativaRateLimit({ escopo: 'password_reset', identifier, sucesso: !error })

  if (!error) {
    await registrarEventoSenha({ tipo: 'PASSWORD_RESET_EMAIL_SENT', userId: profile?.id, audit, dados: { email_hash: hashSeguranca(email) } })
  } else {
    await registrarEventoSenha({
      tipo: 'PASSWORD_CHANGE_FAILED',
      userId: profile?.id,
      audit,
      severidade: 'warning',
      dados: { etapa: 'password_reset_email', code: error.code, status: error.status },
    })
  }

  return { success: true, message: RESET_GENERIC_MESSAGE, notification: { type: 'success', message: RESET_GENERIC_MESSAGE } }
}

export async function iniciarSessaoRecuperacaoSenha(): Promise<PasswordActionState> {
  const audit = await requestAuditContext()
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    await limparFluxoAutenticacao()
    return { success: false, message: 'O link expirou ou ja foi utilizado.', notification: { type: 'error', message: 'O link expirou ou ja foi utilizado.' } }
  }

  await marcarFluxoAutenticacao('password_recovery')
  await registrarEventoSenha({ tipo: 'PASSWORD_RESET_LINK_OPENED', userId: user.id, audit })
  await registrarEventoSenha({ tipo: 'PASSWORD_RECOVERY_SESSION_CREATED', userId: user.id, audit })
  return { success: true, message: 'Sessao de recuperacao iniciada.' }
}

export async function abortarFluxoRecuperacaoSenha(motivo = 'link_invalido'): Promise<PasswordActionState> {
  const audit = await requestAuditContext()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  await Promise.allSettled([
    supabase.auth.signOut({ scope: 'local' }),
    limparFluxoAutenticacao(),
  ])

  await registrarEventoSenha({
    tipo: motivo === 'otp_expired' || motivo === 'link_expirado' ? 'PASSWORD_RESET_LINK_EXPIRED' : 'PASSWORD_RESET_LINK_INVALID',
    userId: user?.id,
    audit,
    severidade: 'warning',
    dados: { motivo },
  })
  await registrarEventoSenha({ tipo: 'PASSWORD_RECOVERY_SESSION_CLEARED', userId: user?.id, audit, dados: { motivo } })

  return { success: true, message: 'Fluxo de recuperacao limpo.' }
}

export async function concluirRedefinicaoSenha(_prevState: PasswordActionState | undefined, formData: FormData): Promise<PasswordActionState> {
  const audit = await requestAuditContext()
  const password = String(formData.get('password') || '')
  const confirmPassword = String(formData.get('confirmPassword') || '')
  const validation = validarNovaSenha({ password, confirmPassword })
  if (!validation.valid) return fieldErrors(validation.errors)

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { success: false, message: 'O link expirou ou ja foi utilizado.', notification: { type: 'error', message: 'O link expirou ou ja foi utilizado.' } }
  }

  const fluxo = await obterFluxoAutenticacao()
  if (fluxo !== 'password_recovery') {
    await registrarEventoSenha({ tipo: 'PASSWORD_RESET_ABORTED', userId: user.id, audit, severidade: 'warning', dados: { motivo: 'fora_do_contexto_password_recovery' } })
    await Promise.allSettled([
      supabase.auth.signOut({ scope: 'local' }),
      limparFluxoAutenticacao(),
    ])
    return { success: false, message: 'Solicite um novo link para redefinir sua senha.', redirectTo: '/esqueci-senha?motivo=fluxo_invalido', notification: { type: 'error', message: 'Solicite um novo link para redefinir sua senha.' } }
  }

  const limited = await verificarRateLimit({ escopo: 'password_change', identifier: user.id, limite: 5, janelaMs: 15 * 60 * 1000 })
  if (!limited.allowed) {
    return { success: false, message: 'Muitas tentativas. Aguarde antes de tentar novamente.', notification: { type: 'warning', message: 'Muitas tentativas. Aguarde antes de tentar novamente.' } }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    await registrarTentativaRateLimit({ escopo: 'password_change', identifier: user.id, sucesso: false })
    await registrarEventoSenha({ tipo: 'PASSWORD_CHANGE_FAILED', userId: user.id, audit, severidade: 'warning', dados: { etapa: 'password_reset_update', code: error.code, status: error.status } })
    if (isAal2Error(error)) {
      await registrarEventoSenha({ tipo: 'MFA_CHALLENGE_AFTER_PASSWORD_RESET', userId: user.id, audit, severidade: 'warning' })
      return {
        success: false,
        requiresMfa: true,
        message: 'Confirme o MFA antes de concluir a redefinicao da senha.',
        redirectTo: '/mfa/desafio?next=/redefinir-senha',
        notification: { type: 'warning', message: 'Confirme o MFA antes de concluir a redefinicao da senha.' },
      }
    }
    return { success: false, message: 'Nao foi possivel redefinir a senha. Solicite um novo link e tente novamente.', notification: { type: 'error', message: 'Nao foi possivel redefinir a senha. Solicite um novo link e tente novamente.' } }
  }

  await registrarTentativaRateLimit({ escopo: 'password_change', identifier: user.id, sucesso: true })

  const now = new Date().toISOString()
  const { data: profile } = await createAdminClient()
    .from('profiles')
    .update({ senha_alterada_em: now, sessoes_revogadas_em: now } as never)
    .eq('id', user.id)
    .select('id, email, nome_completo, role')
    .single()

  await supabase.auth.signOut({ scope: 'others' })
  await registrarEventoSenha({ tipo: 'PASSWORD_RESET_COMPLETED', userId: user.id, audit, dados: { sessoes_antigas_revogadas: true } })

  const profileData = profile as { email?: string | null; nome_completo?: string | null; role?: string | null } | null
  if (profileData?.email) {
    await notificarSenhaAlterada({
      userId: user.id,
      email: profileData.email,
      nome: profileData.nome_completo || 'Usuario',
      audit,
      origem: 'reset',
    })
  }

  const estado = await obterEstadoMfaUsuario(supabase)
  const segundoFatorValido = estado.sessaoElevadaValida && estado.aalAtual === 'aal2' && estado.sessaoElevadaMetodo === 'totp'
  if (estado.exigeMfa && !estado.possuiFatorVerificado) {
    await marcarFluxoAutenticacao('mfa_setup_required')
    await registrarEventoSenha({ tipo: 'MFA_SETUP_REQUIRED_AFTER_RESET', userId: user.id, audit, severidade: 'warning' })
    return { success: true, message: 'Senha redefinida. Configure MFA para continuar.', redirectTo: '/mfa/setup', notification: { type: 'success', message: 'Senha redefinida. Configure MFA para continuar.' } }
  }
  if ((estado.exigeMfa || estado.possuiFatorVerificado) && !segundoFatorValido) {
    await registrarEventoSenha({ tipo: 'MFA_CHALLENGE_AFTER_PASSWORD_RESET', userId: user.id, audit })
    return { success: true, requiresMfa: true, message: 'Senha redefinida. Confirme o MFA para acessar o portal.', redirectTo: '/mfa/desafio', notification: { type: 'success', message: 'Senha redefinida. Confirme o MFA para acessar o portal.' } }
  }

  await limparFluxoAutenticacao()
  return { success: true, message: 'Senha redefinida com sucesso.', redirectTo: dashboardForRole(profileData?.role), notification: { type: 'success', message: 'Senha redefinida com sucesso.' } }
}

export async function alterarSenhaAutenticado(_prevState: PasswordActionState | undefined, formData: FormData): Promise<PasswordActionState> {
  const audit = await requestAuditContext()
  const context = await requireAuthenticated()
  const estadoMfa = await exigirSessaoOperacionalAal2(context)
  if (estadoMfa.aalAtual !== 'aal2' || estadoMfa.sessaoElevadaMetodo !== 'totp') {
    return { success: false, message: 'Valide sua sessao por MFA antes de alterar a senha.', redirectTo: '/mfa/desafio', notification: { type: 'error', message: 'Valide sua sessao por MFA antes de alterar a senha.' } }
  }

  const currentPassword = String(formData.get('currentPassword') || '')
  const password = String(formData.get('password') || '')
  const confirmPassword = String(formData.get('confirmPassword') || '')
  const nonce = String(formData.get('nonce') || '').trim() || null
  const mfaCode = String(formData.get('mfaCode') || '')
  const validation = validarNovaSenha({ password, confirmPassword, currentPassword })
  if (!currentPassword) validation.errors.currentPassword = ['Informe a senha atual.']
  if (!validation.valid || Object.keys(validation.errors).length > 0) return fieldErrors(validation.errors)

  const limited = await verificarRateLimit({ escopo: 'password_change', identifier: context.user.id, limite: 5, janelaMs: 15 * 60 * 1000 })
  if (!limited.allowed) {
    return { success: false, message: 'Muitas tentativas. Aguarde antes de tentar novamente.', notification: { type: 'warning', message: 'Muitas tentativas. Aguarde antes de tentar novamente.' } }
  }

  const email = context.user.email || context.profile.email
  if (!email) {
    await registrarEventoSenha({ tipo: 'PASSWORD_CHANGE_FAILED', userId: context.user.id, audit, severidade: 'warning', dados: { etapa: 'email_usuario_ausente' } })
    return { success: false, message: 'Nao foi possivel validar a identidade do usuario.', notification: { type: 'error', message: 'Nao foi possivel validar a identidade do usuario.' } }
  }

  const senhaAtualValida = await reautenticarSenhaAtual(email, currentPassword)
  if (!senhaAtualValida) {
    await registrarTentativaRateLimit({ escopo: 'password_change', identifier: context.user.id, sucesso: false })
    await registrarEventoSenha({ tipo: 'PASSWORD_CHANGE_FAILED', userId: context.user.id, audit, severidade: 'warning', dados: { etapa: 'reauth_supabase_auth' } })
    return { success: false, message: 'Senha atual invalida.', errors: { currentPassword: ['Senha atual invalida.'] }, notification: { type: 'error', message: 'Senha atual invalida.' } }
  }

  try {
    await autorizarEConsumirAcaoSensivel(context, 'alterar_senha', mfaCode)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível confirmar o MFA para alterar a senha.'
    return { success: false, message, errors: { mfaCode: [message] }, notification: { type: 'error', message } }
  }

  const { error } = await context.supabase.auth.updateUser(criarAtributosUpdateSenha(password, nonce))
  if (error) {
    await registrarTentativaRateLimit({ escopo: 'password_change', identifier: context.user.id, sucesso: false })
    await registrarEventoSenha({ tipo: 'PASSWORD_CHANGE_FAILED', userId: context.user.id, audit, severidade: 'warning', dados: { etapa: 'authenticated_update', code: error.code, status: error.status } })
    const nonceRequired = String(error.code || '').toLowerCase().includes('nonce') || String(error.message || '').toLowerCase().includes('nonce')
    const message = isAal2Error(error)
      ? 'Valide sua sessao por MFA antes de alterar a senha.'
      : nonceRequired
        ? 'O Supabase solicitou reautenticacao por nonce. Solicite o codigo e tente novamente.'
        : 'Nao foi possivel alterar a senha.'
    return { success: false, message, redirectTo: isAal2Error(error) ? '/mfa/desafio' : undefined, notification: { type: 'error', message } }
  }

  await registrarTentativaRateLimit({ escopo: 'password_change', identifier: context.user.id, sucesso: true })
  const now = new Date().toISOString()
  await Promise.all([
    context.supabase.auth.signOut({ scope: 'others' }),
    createAdminClient().from('profiles').update({ senha_alterada_em: now, sessoes_revogadas_em: now } as never).eq('id', context.user.id),
    createAdminClient().from('sessoes_elevadas').update({ revogada_em: now, motivo_revogacao: 'alteracao_senha', updated_at: now } as never).eq('user_id', context.user.id).is('revogada_em', null),
    createAdminClient().from('autorizacoes_acoes_sensiveis').update({ revogada_em: now } as never).eq('user_id', context.user.id).is('revogada_em', null),
  ])
  await registrarEventoSenha({
    tipo: 'PASSWORD_CHANGED',
    userId: context.user.id,
    audit,
    dados: { sessoes_antigas_revogadas: true, origem: 'minha_seguranca' },
  })
  await notificarSenhaAlterada({
    userId: context.user.id,
    email: context.profile.email,
    nome: context.profile.nome_completo,
    audit,
    origem: 'authenticated_change',
  })

  await context.supabase.auth.signOut({ scope: 'local' })
  return { success: true, message: 'Senha alterada com sucesso. Entre novamente.', redirectTo: '/login', notification: { type: 'success', message: 'Senha alterada com sucesso. Entre novamente.' } }
}

export async function solicitarNonceAlteracaoSenha(): Promise<PasswordActionState> {
  const audit = await requestAuditContext()
  const context = await requireAuthenticated()
  await exigirSessaoOperacionalAal2(context)

  const { error } = await context.supabase.auth.reauthenticate()
  if (error) {
    await registrarEventoSenha({
      tipo: 'PASSWORD_CHANGE_FAILED',
      userId: context.user.id,
      audit,
      severidade: 'warning',
      dados: { etapa: 'authenticated_reauth_nonce', code: error.code, status: error.status },
    })
    return {
      success: false,
      message: 'Nao foi possivel solicitar o codigo de reautenticacao.',
      notification: { type: 'error', message: 'Nao foi possivel solicitar o codigo de reautenticacao.' },
    }
  }

  await registrarEventoSenha({
    tipo: 'PASSWORD_REAUTH_NONCE_REQUESTED',
    userId: context.user.id,
    audit,
    dados: { etapa: 'nonce_reautenticacao_solicitado' },
  })
  return {
    success: true,
    message: 'Codigo de reautenticacao enviado pelo Supabase Auth.',
    notification: { type: 'info', message: 'Codigo de reautenticacao enviado pelo Supabase Auth.' },
  }
}

export async function verificarProntidaoRedefinicaoSenha(): Promise<PasswordActionState & { passwordStrength?: ReturnType<typeof avaliarForcaSenha> }> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return { success: false, message: 'O link expirou ou ja foi utilizado.' }
  }

  const fluxo = await obterFluxoAutenticacao()
  if (fluxo !== 'password_recovery') {
    return { success: false, message: 'Solicite um novo link para redefinir sua senha.' }
  }

  return { success: true, message: 'Sessao de redefinicao valida.' }
}
