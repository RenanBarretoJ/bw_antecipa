import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import type { AppSupabaseClient, AuthContext } from '@/lib/auth/authorization'
import { AuthorizationError, requireAuthenticated } from '@/lib/auth/authorization'
import { obterFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import type { Database, Profile, UserRole } from '@/types/database'
import { avaliarValidadeSessaoMfa, MFA_SESSION_DURATION_MS, type MfaSessionStatus } from '@/lib/auth/mfa-session'

export const MFA_ELEVATED_SESSION_WINDOW_MS = MFA_SESSION_DURATION_MS
export const MFA_RECOVERY_CODE_COUNT = 10
export const MFA_TOTP_CODE_PATTERN = /^\d{6}$/
export const MFA_SESSION_EXPIRED_MESSAGE = 'Sua sessão de segurança de 24 horas expirou. Entre novamente para continuar.'

export const ACAO_SENSIVEL_TIPOS = [
  'alterar_senha',
  'alterar_email',
  'regenerar_recovery_codes',
  'encerrar_outras_sessoes',
  'reset_mfa_administrativo',
  'cadastrar_credencial_integracao',
  'rotacionar_credencial_integracao',
  'ativar_credencial_integracao',
  'revogar_credencial_integracao',
  'criar_fundo',
  'atualizar_fundo_estrutural',
  'ativar_fundo',
  'desativar_fundo',
  'convidar_usuario_admin',
  'vincular_gestor_fundo',
  'revogar_gestor_fundo',
  'reativar_gestor_fundo',
  'desativar_usuario',
  'reativar_usuario',
  'conceder_super_admin',
  'revogar_super_admin',
] as const

export type AcaoSensivelTipo = typeof ACAO_SENSIVEL_TIPOS[number]
export type { MfaSessionStatus } from '@/lib/auth/mfa-session'

export type AuthenticatorAssuranceLevel = 'aal1' | 'aal2'

export class MfaSessionError extends AuthorizationError {
  readonly mfaCode: 'MFA_REQUIRED' | 'MFA_SESSION_EXPIRED' | 'MFA_SESSION_REVOKED' | 'MFA_SESSION_INVALID'
  readonly expiraEm: string | null

  constructor(message: string, mfaCode: MfaSessionError['mfaCode'], expiraEm: string | null = null) {
    super(message, 'FORBIDDEN')
    this.name = 'MfaSessionError'
    this.mfaCode = mfaCode
    this.expiraEm = expiraEm
  }
}

export type EventoSegurancaTipo =
  | 'MFA_ENROLL_INICIADO'
  | 'MFA_ATIVADO'
  | 'MFA_DESATIVADO'
  | 'MFA_FALHA'
  | 'MFA_RECOVERY_USADO'
  | 'MFA_RECOVERY_REGENERADO'
  | 'MFA_RESET_ADMINISTRATIVO'
  | 'SESSAO_ELEVADA'
  | 'SESSOES_REVOGADAS'
  | 'CREDENCIAL_CRIADA'
  | 'CREDENCIAL_TESTADA'
  | 'CREDENCIAL_ATIVADA'
  | 'CREDENCIAL_ROTACIONADA'
  | 'CREDENCIAL_REVOGADA'
  | 'CREDENCIAL_USADA'
  | 'ACESSO_CREDENCIAL_NEGADO'
  | 'ACESSO_NEGADO'
  | 'RATE_LIMIT_BLOQUEADO'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_EMAIL_SENT'
  | 'PASSWORD_RESET_LINK_OPENED'
  | 'PASSWORD_RESET_LINK_INVALID'
  | 'PASSWORD_RESET_LINK_EXPIRED'
  | 'PASSWORD_RECOVERY_SESSION_CREATED'
  | 'PASSWORD_RECOVERY_SESSION_CLEARED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'PASSWORD_RESET_ABORTED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_CHANGE_FAILED'
  | 'PASSWORD_REAUTH_NONCE_REQUESTED'
  | 'MFA_SETUP_REQUIRED_AFTER_RESET'
  | 'MFA_CHALLENGE_AFTER_PASSWORD_RESET'
  | 'MFA_VERIFIED_AFTER_PASSWORD_RESET'
  | 'MFA_FAILED_AFTER_PASSWORD_RESET'
  | 'RECOVERY_CODE_USED'
  | 'MFA_REENROLL_REQUIRED'
  | 'AUTH_FLOW_BLOCKED_ROUTE_ATTEMPT'
  | 'MFA_LOGIN_VALIDADO'
  | 'MFA_LOGIN_FALHOU'
  | 'SESSAO_MFA_EXPIRADA'
  | 'SESSAO_MFA_REVOGADA'
  | 'MFA_ACAO_SENSIVEL_VALIDADA'
  | 'MFA_ACAO_SENSIVEL_FALHOU'
  | 'AUTORIZACAO_SENSIVEL_CONSUMIDA'
  | 'AUTORIZACAO_SENSIVEL_REUTILIZACAO_BLOQUEADA'

export type MfaEstadoUsuario = {
  exigeMfa: boolean
  possuiFatorVerificado: boolean
  aalAtual: AuthenticatorAssuranceLevel
  aalProximo: AuthenticatorAssuranceLevel
  sessaoElevadaValida: boolean
  sessaoId: string | null
  sessaoStatus: MfaSessionStatus
  sessaoElevadaEm: string | null
  sessaoExpiraEm: string | null
  serverNow: string
  sessaoElevadaMetodo: 'totp' | 'recovery_code' | 'admin_reset' | null
  fatoresTotp: Array<{ id: string; friendly_name?: string | null; status?: string | null; factor_type?: string | null }>
  recoveryCodesRestantes: number
}

type MfaClient = SupabaseClient<Database> & {
  auth: SupabaseClient<Database>['auth'] & {
    mfa: {
      enroll(input: { factorType: 'totp'; friendlyName?: string }): Promise<{ data: unknown; error: { message: string } | null }>
      challenge(input: { factorId: string }): Promise<{ data: { id: string } | null; error: { message: string } | null }>
      verify(input: { factorId: string; challengeId: string; code: string }): Promise<{ data: unknown; error: { message: string } | null }>
      listFactors(): Promise<{ data: { totp?: unknown[]; all?: unknown[] } | null; error: { message: string } | null }>
      unenroll(input: { factorId: string }): Promise<{ data: unknown; error: { message: string } | null }>
      getAuthenticatorAssuranceLevel(): Promise<{ data: { currentLevel: string | null; nextLevel: string | null } | null; error: { message: string } | null }>
    }
  }
}

export function sanitizarCodigoTotp(code: string) {
  return code.replace(/\D/g, '').slice(0, 6)
}

export function validarFormatoCodigoTotp(code: string) {
  return MFA_TOTP_CODE_PATTERN.test(code)
}

export function usuarioExigeMfaPorPerfil(role: UserRole, override?: boolean | null) {
  if (override === true) return true
  return ['gestor', 'consultor', 'cedente', 'sacado', 'super_admin'].includes(role)
}

export function hashSeguranca(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function nowIso() {
  return new Date().toISOString()
}

function mfaClient(client: SupabaseClient<Database>): MfaClient {
  return client as MfaClient
}

export function isAcaoSensivelTipo(value: string): value is AcaoSensivelTipo {
  return (ACAO_SENSIVEL_TIPOS as readonly string[]).includes(value)
}

function normalizeAal(value: string | null | undefined): AuthenticatorAssuranceLevel {
  return value === 'aal2' ? 'aal2' : 'aal1'
}

function normalizeFactor(factor: unknown): MfaEstadoUsuario['fatoresTotp'][number] {
  const value = factor as Record<string, unknown>
  return {
    id: String(value.id || ''),
    friendly_name: typeof value.friendly_name === 'string' ? value.friendly_name : null,
    status: typeof value.status === 'string' ? value.status : null,
    factor_type: typeof value.factor_type === 'string' ? value.factor_type : null,
  }
}

async function usuarioEhAdministradorCedente(client: AppSupabaseClient, userId: string, role: UserRole) {
  if (role !== 'cedente') return false

  const [{ data: cedenteProprio }, { data: acessoAdministrador }] = await Promise.all([
    client.from('cedentes').select('id').eq('user_id', userId).maybeSingle(),
    client
      .from('cedente_acessos')
      .select('id')
      .eq('user_id', userId)
      .eq('ativo', true)
      .eq('perfil', 'administrador')
      .maybeSingle(),
  ])

  return !!cedenteProprio || !!acessoAdministrador
}

export async function usuarioExigeMfa(context: Pick<AuthContext, 'supabase' | 'user' | 'profile'>) {
  const override = (context.profile as Profile & { mfa_obrigatorio_override?: boolean | null }).mfa_obrigatorio_override
  if (usuarioExigeMfaPorPerfil(context.profile.role, override)) return true
  return usuarioEhAdministradorCedente(context.supabase, context.user.id, context.profile.role)
}

export async function obterEstadoMfaUsuario(client?: AppSupabaseClient): Promise<MfaEstadoUsuario> {
  const context = await requireAuthenticated(client, { allowMfaPending: true })
  const supabase = mfaClient(context.supabase)
  const [{ data: aalData }, { data: factorsData }, { data: sessaoData, error: sessaoError }, { count: recoveryCount }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
    context.supabase.rpc('obter_sessao_mfa_atual'),
    context.supabase
      .from('mfa_recovery_codes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', context.user.id)
      .is('usado_em', null)
      .is('invalidado_em', null),
  ])

  const fatoresTotp = (factorsData?.totp || []).map(normalizeFactor).filter((factor) => factor.id)
  const possuiFatorVerificado = fatoresTotp.some((factor) => factor.status === 'verified')
  const exigeMfa = await usuarioExigeMfa(context)
  if (sessaoError) throw new Error(`Erro ao validar sessao MFA: ${sessaoError.message}`)
  const sessao = (Array.isArray(sessaoData) ? sessaoData[0] : sessaoData) as {
    session_id?: string | null
    status?: MfaSessionStatus
    elevada_em?: string | null
    expira_em?: string | null
    server_now?: string
    metodo?: 'totp' | 'recovery_code' | 'admin_reset' | null
  } | null
  const serverNow = sessao?.server_now || nowIso()
  const sessaoStatus = sessao?.status || 'missing'

  return {
    exigeMfa,
    possuiFatorVerificado,
    aalAtual: normalizeAal(aalData?.currentLevel),
    aalProximo: normalizeAal(aalData?.nextLevel),
    sessaoElevadaValida: avaliarValidadeSessaoMfa({ status: sessaoStatus, expiraEm: sessao?.expira_em || null, serverNow }),
    sessaoId: sessao?.session_id || null,
    sessaoStatus,
    sessaoElevadaEm: sessao?.elevada_em || null,
    sessaoExpiraEm: sessao?.expira_em || null,
    serverNow,
    sessaoElevadaMetodo: sessao?.metodo || null,
    fatoresTotp,
    recoveryCodesRestantes: recoveryCount || 0,
  }
}

export async function validarNivelAutenticacao(client?: AppSupabaseClient) {
  const estado = await obterEstadoMfaUsuario(client)
  return estado.aalAtual === 'aal2'
}

export async function exigirMfaConfigurado(client?: AppSupabaseClient) {
  const estado = await obterEstadoMfaUsuario(client)
  if (estado.exigeMfa && !estado.possuiFatorVerificado) {
    throw new AuthorizationError('Configure MFA para continuar.', 'FORBIDDEN')
  }
  return estado
}

export async function exigirSessaoElevada(context?: AuthContext) {
  return requireSessaoMfaValida(context)
}

export async function requireSessaoMfaValida(context?: AuthContext) {
  const authContext = context ?? await requireAuthenticated(undefined, { allowMfaPending: true })
  if (authContext.profile.status !== 'ativo') {
    throw new AuthorizationError('Perfil de usuario inativo.', 'FORBIDDEN')
  }
  const fluxo = await obterFluxoAutenticacao()
  if (fluxo) {
    await registrarEventoSeguranca({
      tipo_evento: 'ACESSO_NEGADO',
      usuario_id: authContext.user.id,
      ator_usuario_id: authContext.user.id,
      severidade: 'warning',
      dados: { motivo: 'fluxo_autenticacao_restrito', fluxo },
    })
    throw new AuthorizationError('Sessao em fluxo restrito nao pode executar esta acao.', 'FORBIDDEN')
  }

  const estado = await obterEstadoMfaUsuario(authContext.supabase)
  const segundoFatorValido = estado.sessaoElevadaValida && estado.aalAtual === 'aal2' && estado.sessaoElevadaMetodo === 'totp'
  if (estado.exigeMfa && (!estado.possuiFatorVerificado || !segundoFatorValido)) {
    if (estado.sessaoStatus === 'expired') {
      await authContext.supabase.rpc('revogar_sessao_mfa_atual', { p_motivo: 'expiracao_24h' })
      throw new MfaSessionError(MFA_SESSION_EXPIRED_MESSAGE, 'MFA_SESSION_EXPIRED', estado.sessaoExpiraEm)
    }
    await registrarEventoSeguranca({
      tipo_evento: 'ACESSO_NEGADO',
      usuario_id: authContext.user.id,
      ator_usuario_id: authContext.user.id,
      severidade: 'warning',
      dados: { motivo: 'sessao_elevada_requerida', aal: estado.aalAtual },
    })
    const code = estado.sessaoStatus === 'revoked' ? 'MFA_SESSION_REVOKED' : estado.sessaoStatus === 'session_invalid' ? 'MFA_SESSION_INVALID' : 'MFA_REQUIRED'
    throw new MfaSessionError('Confirme o MFA desta sessão para continuar.', code, estado.sessaoExpiraEm)
  }
  return estado
}

export async function exigirSessaoOperacionalAal2(context?: AuthContext) {
  return requireSessaoMfaValida(context)
}

export async function registrarSessaoElevada(userId: string, metodo: 'totp', factorId: string, client?: AppSupabaseClient) {
  const context = await requireAuthenticated(client, { allowMfaPending: true })
  if (context.user.id !== userId || metodo !== 'totp') throw new AuthorizationError('Contexto MFA invalido.', 'FORBIDDEN')
  const { data, error } = await context.supabase.rpc('registrar_sessao_mfa_atual', { p_factor_id: factorId })
  const registrada = Array.isArray(data) ? data[0] : data
  if (error || !registrada) throw new Error(`Erro ao registrar sessao elevada: ${error?.message || 'registro nao retornado'}`)
  const elevatedAt = registrada.elevada_em
  await createAdminClient().from('profiles').update({ ultima_autenticacao_forte_em: elevatedAt } as never).eq('id', userId)
  await registrarEventoSeguranca({
    tipo_evento: 'MFA_LOGIN_VALIDADO',
    usuario_id: userId,
    ator_usuario_id: userId,
    dados: { metodo, session_id: registrada.session_id, expira_em: registrada.expira_em, janela_horas: 24 },
  })
  return registrada
}

export async function registrarEventoSeguranca(input: {
  tipo_evento: EventoSegurancaTipo
  usuario_id?: string | null
  ator_usuario_id?: string | null
  ator_tipo?: 'usuario' | 'sistema' | 'cron' | 'integracao'
  origem?: string
  severidade?: 'info' | 'warning' | 'critical'
  entidade_tipo?: string | null
  entidade_id?: string | null
  ip_hash?: string | null
  user_agent_hash?: string | null
  correlation_id?: string | null
  dados?: Record<string, unknown>
}) {
  const admin = createAdminClient()
  await admin.from('seguranca_eventos').insert({
    tipo_evento: input.tipo_evento,
    usuario_id: input.usuario_id || null,
    ator_usuario_id: input.ator_usuario_id || null,
    ator_tipo: input.ator_tipo || 'usuario',
    origem: input.origem || 'app',
    severidade: input.severidade || 'info',
    entidade_tipo: input.entidade_tipo || null,
    entidade_id: input.entidade_id || null,
    ip_hash: input.ip_hash || null,
    user_agent_hash: input.user_agent_hash || null,
    correlation_id: input.correlation_id || null,
    dados: input.dados || {},
  } as never)
}

export function gerarRecoveryCodes(count = MFA_RECOVERY_CODE_COUNT) {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(6).toString('hex').toUpperCase()
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
  })
}

export function hashRecoveryCode(userId: string, code: string) {
  return hashSeguranca(`${userId}:${code.replace(/[^A-Z0-9]/gi, '').toUpperCase()}`)
}

export async function substituirRecoveryCodes(userId: string) {
  const admin = createAdminClient()
  const codes = gerarRecoveryCodes()
  const geracaoId = randomUUID()
  const invalidadoEm = nowIso()

  await admin
    .from('mfa_recovery_codes')
    .update({ invalidado_em: invalidadoEm } as never)
    .eq('user_id', userId)
    .is('usado_em', null)
    .is('invalidado_em', null)

  const { error } = await admin.from('mfa_recovery_codes').insert(codes.map((code) => ({
    user_id: userId,
    code_hash: hashRecoveryCode(userId, code),
    geracao_id: geracaoId,
  })) as never)

  if (error) throw new Error(`Erro ao gerar codigos de recuperacao: ${error.message}`)
  return codes
}

export async function usarRecoveryCode(userId: string, code: string) {
  const admin = createAdminClient()
  const codeHash = hashRecoveryCode(userId, code)
  const { data } = await admin
    .from('mfa_recovery_codes')
    .select('id')
    .eq('user_id', userId)
    .eq('code_hash', codeHash)
    .is('usado_em', null)
    .is('invalidado_em', null)
    .maybeSingle()

  if (!data) return false

  const { error } = await admin
    .from('mfa_recovery_codes')
    .update({ usado_em: nowIso(), usado_por: userId } as never)
    .eq('id', (data as { id: string }).id)
    .is('usado_em', null)

  if (error) return false
  await registrarEventoSeguranca({ tipo_evento: 'MFA_RECOVERY_USADO', usuario_id: userId, ator_usuario_id: userId, severidade: 'warning' })
  await registrarEventoSeguranca({ tipo_evento: 'RECOVERY_CODE_USED', usuario_id: userId, ator_usuario_id: userId, severidade: 'warning' })
  return true
}

export async function getCurrentUserOrThrow(): Promise<{ user: User; supabase: AppSupabaseClient }> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new AuthorizationError('Usuario nao autenticado.', 'UNAUTHENTICATED')
  return { user, supabase }
}
