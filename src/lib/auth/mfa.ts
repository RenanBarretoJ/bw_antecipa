import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import type { AppSupabaseClient, AuthContext } from '@/lib/auth/authorization'
import { AuthorizationError, requireAuthenticated } from '@/lib/auth/authorization'
import type { Database, Profile, UserRole } from '@/types/database'

export const MFA_ELEVATED_SESSION_WINDOW_MS = 15 * 60 * 1000
export const MFA_RECOVERY_CODE_COUNT = 10
export const MFA_TOTP_CODE_PATTERN = /^\d{6}$/

export type AuthenticatorAssuranceLevel = 'aal1' | 'aal2'

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
  | 'CREDENCIAL_ROTACIONADA'
  | 'ACESSO_NEGADO'
  | 'RATE_LIMIT_BLOQUEADO'

export type MfaEstadoUsuario = {
  exigeMfa: boolean
  possuiFatorVerificado: boolean
  aalAtual: AuthenticatorAssuranceLevel
  aalProximo: AuthenticatorAssuranceLevel
  sessaoElevadaValida: boolean
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
  if (override !== null && override !== undefined) return override
  return role === 'gestor' || role === 'consultor'
}

export function hashSeguranca(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function nowIso() {
  return new Date().toISOString()
}

function expirationIso(windowMs = MFA_ELEVATED_SESSION_WINDOW_MS) {
  return new Date(Date.now() + windowMs).toISOString()
}

function mfaClient(client: SupabaseClient<Database>): MfaClient {
  return client as MfaClient
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
  const context = await requireAuthenticated(client)
  const supabase = mfaClient(context.supabase)
  const [{ data: aalData }, { data: factorsData }, { data: elevated }, { count: recoveryCount }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
    context.supabase
      .from('sessoes_elevadas')
      .select('expira_em')
      .eq('user_id', context.user.id)
      .gt('expira_em', nowIso())
      .maybeSingle(),
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

  return {
    exigeMfa,
    possuiFatorVerificado,
    aalAtual: normalizeAal(aalData?.currentLevel),
    aalProximo: normalizeAal(aalData?.nextLevel),
    sessaoElevadaValida: !!elevated,
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
  const authContext = context ?? await requireAuthenticated()
  const estado = await obterEstadoMfaUsuario(authContext.supabase)
  if (estado.exigeMfa && (!estado.possuiFatorVerificado || estado.aalAtual !== 'aal2' || !estado.sessaoElevadaValida)) {
    await registrarEventoSeguranca({
      tipo_evento: 'ACESSO_NEGADO',
      usuario_id: authContext.user.id,
      ator_usuario_id: authContext.user.id,
      severidade: 'warning',
      dados: { motivo: 'sessao_elevada_requerida', aal: estado.aalAtual },
    })
    throw new AuthorizationError('Sessao elevada por MFA obrigatoria para esta acao.', 'FORBIDDEN')
  }
  return estado
}

export async function registrarSessaoElevada(userId: string, metodo: 'totp' | 'recovery_code' | 'admin_reset', factorId?: string | null) {
  const admin = createAdminClient()
  const elevatedAt = nowIso()
  const { error } = await admin.from('sessoes_elevadas').upsert({
    user_id: userId,
    aal: 'aal2',
    metodo,
    factor_id: factorId || null,
    elevada_em: elevatedAt,
    expira_em: expirationIso(),
    updated_at: elevatedAt,
  } as never)

  if (error) throw new Error(`Erro ao registrar sessao elevada: ${error.message}`)

  await admin.from('profiles').update({ ultima_autenticacao_forte_em: elevatedAt } as never).eq('id', userId)
  await registrarEventoSeguranca({
    tipo_evento: 'SESSAO_ELEVADA',
    usuario_id: userId,
    ator_usuario_id: userId,
    dados: { metodo, janela_minutos: MFA_ELEVATED_SESSION_WINDOW_MS / 60000 },
  })
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
  await registrarSessaoElevada(userId, 'recovery_code')
  await registrarEventoSeguranca({ tipo_evento: 'MFA_RECOVERY_USADO', usuario_id: userId, ator_usuario_id: userId, severidade: 'warning' })
  return true
}

export async function getCurrentUserOrThrow(): Promise<{ user: User; supabase: AppSupabaseClient }> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new AuthorizationError('Usuario nao autenticado.', 'UNAUTHENTICATED')
  return { user, supabase }
}
