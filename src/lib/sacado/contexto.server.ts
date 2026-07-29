import 'server-only'

import type { AuthContext } from '@/lib/auth/authorization'
import { requireRole } from '@/lib/auth/authorization'

export type ContextoSacado = {
  auth: AuthContext
  sacadoId: string
  cnpj: string
  razaoSocial: string
}

export function normalizarCnpjSacado(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '')
}

/**
 * Resolve a identidade canonica do sacado exclusivamente pela sessao.
 *
 * O modelo atual nao possui tenant_id nem fundo ativo no cadastro do sacado.
 * A visao autorizada continua consolidada pelo CNPJ destinatario e protegida
 * pelas policies RLS existentes.
 */
export async function resolverContextoSacado(): Promise<ContextoSacado> {
  const auth = await requireRole('sacado')
  if (auth.profile.status !== 'ativo') {
    throw new Error('O perfil do sacado nao esta ativo.')
  }

  const { data, error } = await auth.supabase
    .from('sacados')
    .select('id, cnpj, razao_social')
    .eq('user_id', auth.user.id)
    .maybeSingle()

  if (error) throw new Error(`Nao foi possivel consultar o sacado autenticado: ${error.message}`)
  if (!data) throw new Error('Sacado autenticado nao encontrado.')

  const cnpj = normalizarCnpjSacado(data.cnpj)
  if (cnpj.length !== 14) {
    throw new Error('O CNPJ do sacado autenticado esta invalido.')
  }

  return {
    auth,
    sacadoId: data.id,
    cnpj,
    razaoSocial: data.razao_social,
  }
}
