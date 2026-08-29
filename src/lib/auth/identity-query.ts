import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Profile } from '@/types/database'

export type IdentityDiagnosticCode =
  | 'PROFILE_QUERY_FAILED'
  | 'PROFILE_NOT_FOUND'
  | 'USER_ROLES_QUERY_FAILED'
  | 'USER_ROLES_NOT_FOUND'

export class IdentityQueryError extends Error {
  readonly diagnosticCode: Extract<IdentityDiagnosticCode, 'PROFILE_QUERY_FAILED' | 'USER_ROLES_QUERY_FAILED'>
  readonly databaseCode: string | null

  constructor(
    diagnosticCode: IdentityQueryError['diagnosticCode'],
    databaseCode: string | null,
  ) {
    super('Nao foi possivel validar a identidade autenticada.')
    this.name = 'IdentityQueryError'
    this.diagnosticCode = diagnosticCode
    this.databaseCode = databaseCode
  }
}

type QueryFailure = {
  code?: string | null
  message?: string | null
}

export function reportIdentityDiagnostic(
  code: IdentityDiagnosticCode,
  error?: QueryFailure | null,
): void {
  const payload = error
    ? {
        databaseCode: error.code || null,
        databaseMessage: error.message || 'Database query failed',
      }
    : undefined

  if (code.endsWith('_FAILED')) {
    console.error(`[auth][${code}]`, payload)
    return
  }

  console.warn(`[auth][${code}]`)
}

export type SessionProfile = Pick<
  Profile,
  | 'id'
  | 'role'
  | 'status'
  | 'nome_completo'
  | 'email'
  | 'mfa_obrigatorio_override'
  | 'mfa_ativado_em'
  | 'ultima_autenticacao_forte_em'
  | 'senha_alterada_em'
>

export async function loadSessionProfile(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<SessionProfile | null> {
  const { data, error } = await client
    .from('profiles')
    .select('id, role, status, nome_completo, email, mfa_obrigatorio_override, mfa_ativado_em, ultima_autenticacao_forte_em, senha_alterada_em')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    reportIdentityDiagnostic('PROFILE_QUERY_FAILED', error)
    throw new IdentityQueryError('PROFILE_QUERY_FAILED', error.code || null)
  }

  if (!data) {
    reportIdentityDiagnostic('PROFILE_NOT_FOUND')
    return null
  }

  return data as SessionProfile
}
