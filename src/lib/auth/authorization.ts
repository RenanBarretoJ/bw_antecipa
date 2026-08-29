import type { User } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { IdentityQueryError, loadSessionProfile } from '@/lib/auth/identity-query'
import type { Cedente, Database, NotaFiscal, Operacao, Profile, UserRole } from '@/types/database'

export type AppSupabaseClient = SupabaseClient<Database>

export class AuthorizationError extends Error {
  readonly status: 401 | 403 | 404
  readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND'

  constructor(
    message: string,
    code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND',
  ) {
    super(message)
    this.name = 'AuthorizationError'
    this.code = code
    this.status = code === 'UNAUTHENTICATED' ? 401 : code === 'NOT_FOUND' ? 404 : 403
  }
}

export interface AuthContext {
  supabase: AppSupabaseClient
  user: User
  profile: Pick<Profile, 'id' | 'role' | 'status' | 'nome_completo' | 'email' | 'mfa_obrigatorio_override' | 'mfa_ativado_em' | 'ultima_autenticacao_forte_em' | 'senha_alterada_em'>
}

type RequireAuthenticatedOptions = {
  /** Usado exclusivamente pelas rotas que configuram ou confirmam o próprio MFA. */
  allowMfaPending?: boolean
}

type CedenteContext = AuthContext & { cedente: Cedente }
export type CedenteAccessProfile = 'ADMIN' | 'OPERACIONAL'
export type CedenteAccessScope = 'operacional' | 'administrativo'
export type CedenteOrganizationalContext = CedenteContext & {
  cedenteAccess: { cedenteId: string; perfil: CedenteAccessProfile }
}
type OperacaoContext = AuthContext & { operacao: Pick<Operacao, 'id' | 'cedente_id'> }
type NotaFiscalContext = AuthContext & { notaFiscal: Pick<NotaFiscal, 'id' | 'cedente_id' | 'cnpj_destinatario'> }

/** Pure rule exported for unit tests and for callers that already have a profile. */
export function assertRole(actualRole: UserRole, allowedRoles: readonly UserRole[]): void {
  if (!allowedRoles.includes(actualRole)) {
    throw new AuthorizationError('Acesso negado para o perfil atual.', 'FORBIDDEN')
  }
}

export function canAccessCedente({
  role,
  hasDelegatedAccess,
  hasConsultorLink,
}: {
  role: UserRole
  hasDelegatedAccess: boolean
  hasConsultorLink: boolean
}): boolean {
  if (role === 'gestor' || hasDelegatedAccess) return true
  return role === 'consultor' && hasConsultorLink
}

export async function requireAuthenticated(client?: AppSupabaseClient, options: RequireAuthenticatedOptions = {}): Promise<AuthContext> {
  const supabase = client ?? await createClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    throw new AuthorizationError('Usuário não autenticado.', 'UNAUTHENTICATED')
  }

  let profile
  try {
    profile = await loadSessionProfile(supabase, data.user.id)
  } catch (queryError) {
    if (queryError instanceof IdentityQueryError) {
      throw new AuthorizationError('Não foi possível validar a identidade do usuário.', 'FORBIDDEN')
    }
    throw queryError
  }

  if (!profile) {
    throw new AuthorizationError('Perfil do usuário não encontrado.', 'FORBIDDEN')
  }

  if (profile.status !== 'ativo') {
    throw new AuthorizationError('Perfil de usuário inativo.', 'FORBIDDEN')
  }

  if (!options.allowMfaPending && ['gestor', 'consultor', 'cedente', 'sacado', 'super_admin'].includes(String(profile.role))) {
    const { data: mfaRows, error: mfaError } = await supabase.rpc('obter_sessao_mfa_atual')
    const mfaSession = (Array.isArray(mfaRows) ? mfaRows[0] : mfaRows) as { status?: string } | null
    if (mfaError) throw new AuthorizationError('Não foi possível validar a sessão de segurança.', 'FORBIDDEN')
    if (mfaSession?.status !== 'valid') {
      const message = mfaSession?.status === 'expired'
        ? 'Sua sessão de segurança de 24 horas expirou. Entre novamente para continuar.'
        : 'Confirme o MFA desta sessão para continuar.'
      throw new AuthorizationError(message, 'FORBIDDEN')
    }
  }

  return {
    supabase,
    user: data.user,
    profile: profile as Pick<Profile, 'id' | 'role' | 'status' | 'nome_completo' | 'email' | 'mfa_obrigatorio_override' | 'mfa_ativado_em' | 'ultima_autenticacao_forte_em' | 'senha_alterada_em'>,
  }
}

export async function requireRole(
  allowedRoles: UserRole | readonly UserRole[],
  client?: AppSupabaseClient,
): Promise<AuthContext> {
  const context = await requireAuthenticated(client)
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]
  assertRole(context.profile.role, roles)
  return context
}

export async function requireGestor(client?: AppSupabaseClient): Promise<AuthContext> {
  return requireRole('gestor', client)
}

async function loadCedente(client: AppSupabaseClient, cedenteId: string): Promise<Cedente> {
  const { data, error } = await client
    .from('cedentes')
    .select('*')
    .eq('id', cedenteId)
    .maybeSingle()

  if (error || !data) {
    throw new AuthorizationError('Cedente não encontrado.', 'NOT_FOUND')
  }

  return data as Cedente
}

async function getSacadoCnpjDoUsuario(client: AppSupabaseClient, userId: string): Promise<string | null> {
  const { data } = await client
    .from('sacados')
    .select('cnpj')
    .eq('user_id', userId)
    .maybeSingle()

  const cnpj = String((data as { cnpj?: string } | null)?.cnpj ?? '').replace(/\D/g, '')
  return cnpj.length === 14 ? cnpj : null
}

/** Resolve acesso ao Cedente pela associacao canonica ativa. */
export async function requireCedenteAccess(
  cedenteId: string,
  client?: AppSupabaseClient,
): Promise<CedenteContext> {
  const context = await requireAuthenticated(client)
  const cedente = await loadCedente(context.supabase, cedenteId)

  if (context.profile.role === 'gestor') return { ...context, cedente }
  let hasConsultorLink = false
  if (context.profile.role === 'consultor') {
    const { data: consultorVinculo } = await context.supabase
      .from('consultor_cedente')
      .select('id')
      .eq('consultor_id', context.user.id)
      .eq('cedente_id', cedenteId)
      .maybeSingle()

    hasConsultorLink = !!consultorVinculo
  }

  // A RPC SECURITY DEFINER resolve somente associacao ATIVA e mantem o
  // fallback legado isolado no banco, sem checks de owner espalhados.
  const { data: cedenteIdDoUsuario } = await context.supabase.rpc('get_user_cedente_id')

  if (!canAccessCedente({
    role: context.profile.role,
    hasDelegatedAccess: cedenteIdDoUsuario === cedenteId,
    hasConsultorLink,
  })) {
    throw new AuthorizationError('Usuário sem vínculo com o cedente.', 'FORBIDDEN')
  }

  return { ...context, cedente }
}

/**
 * Gate canonico para o portal do Cedente.
 * ADMIN satisfaz os dois escopos; OPERACIONAL satisfaz apenas o operacional.
 */
export async function requireCedenteOrganizationalAccess(
  scope: CedenteAccessScope = 'operacional',
  client?: AppSupabaseClient,
  expectedCedenteId?: string,
): Promise<CedenteOrganizationalContext> {
  const context = await requireRole('cedente', client)
  const [cedenteResult, perfilResult] = await Promise.all([
    context.supabase.rpc('get_user_cedente_id'),
    context.supabase.rpc('get_user_cedente_perfil_canonico'),
  ])

  if (cedenteResult.error || perfilResult.error) {
    throw new AuthorizationError('Nao foi possivel validar o acesso organizacional ao cedente.', 'FORBIDDEN')
  }

  const cedenteId = cedenteResult.data
  const perfil = perfilResult.data as CedenteAccessProfile | null
  if (!cedenteId || (perfil !== 'ADMIN' && perfil !== 'OPERACIONAL')) {
    throw new AuthorizationError('Usuario sem associacao ativa com o cedente.', 'FORBIDDEN')
  }
  if (expectedCedenteId && expectedCedenteId !== cedenteId) {
    throw new AuthorizationError('Usuario sem vinculo com o cedente informado.', 'FORBIDDEN')
  }
  if (scope === 'administrativo' && perfil !== 'ADMIN') {
    throw new AuthorizationError('Esta acao exige perfil ADMIN do cedente.', 'FORBIDDEN')
  }

  const cedente = await loadCedente(context.supabase, cedenteId)
  return { ...context, cedente, cedenteAccess: { cedenteId, perfil } }
}

export async function requireOperationAccess(
  operacaoId: string,
  client?: AppSupabaseClient,
): Promise<OperacaoContext> {
  const context = await requireAuthenticated(client)
  const { data: operacao, error } = await context.supabase
    .from('operacoes')
    .select('id, cedente_id')
    .eq('id', operacaoId)
    .maybeSingle()

  if (error || !operacao) {
    throw new AuthorizationError('Operação não encontrada.', 'NOT_FOUND')
  }

  if (context.profile.role === 'sacado') {
    const sacadoCnpj = await getSacadoCnpjDoUsuario(context.supabase, context.user.id)
    if (!sacadoCnpj) throw new AuthorizationError('Sacado nÃ£o encontrado.', 'FORBIDDEN')

    const { data: vinculo } = await context.supabase
      .from('operacoes_nfs')
      .select('nota_fiscal_id, notas_fiscais!inner(cnpj_destinatario)')
      .eq('operacao_id', operacaoId)
      .eq('notas_fiscais.cnpj_destinatario', sacadoCnpj)
      .limit(1)
      .maybeSingle()

    if (!vinculo) {
      throw new AuthorizationError('OperaÃ§Ã£o nÃ£o vinculada ao sacado autenticado.', 'FORBIDDEN')
    }

    return { ...context, operacao: operacao as Pick<Operacao, 'id' | 'cedente_id'> }
  }

  await requireCedenteAccess(operacao.cedente_id, context.supabase)
  return { ...context, operacao: operacao as Pick<Operacao, 'id' | 'cedente_id'> }
}

export async function requireNotaFiscalAccess(
  notaFiscalId: string,
  client?: AppSupabaseClient,
): Promise<NotaFiscalContext> {
  const context = await requireAuthenticated(client)
  const { data: notaFiscal, error } = await context.supabase
    .from('notas_fiscais')
    .select('id, cedente_id, cnpj_destinatario')
    .eq('id', notaFiscalId)
    .maybeSingle()

  if (error || !notaFiscal) {
    throw new AuthorizationError('Nota fiscal não encontrada.', 'NOT_FOUND')
  }

  if (context.profile.role === 'sacado') {
    const sacadoCnpj = await getSacadoCnpjDoUsuario(context.supabase, context.user.id)
    const nfCnpj = String((notaFiscal as { cnpj_destinatario?: string }).cnpj_destinatario ?? '').replace(/\D/g, '')
    if (!sacadoCnpj || nfCnpj !== sacadoCnpj) {
      throw new AuthorizationError('Nota fiscal nÃ£o vinculada ao sacado autenticado.', 'FORBIDDEN')
    }

    return { ...context, notaFiscal: notaFiscal as Pick<NotaFiscal, 'id' | 'cedente_id' | 'cnpj_destinatario'> }
  }

  await requireCedenteAccess(notaFiscal.cedente_id, context.supabase)
  return { ...context, notaFiscal: notaFiscal as Pick<NotaFiscal, 'id' | 'cedente_id' | 'cnpj_destinatario'> }
}

export function isRegisteredStoragePath(path: string, registeredPaths: readonly (string | null | undefined)[]): boolean {
  return registeredPaths.some((registeredPath) => registeredPath !== null && registeredPath !== undefined && registeredPath === path)
}
