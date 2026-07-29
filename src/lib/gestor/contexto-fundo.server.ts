import 'server-only'

import { cookies } from 'next/headers'
import type { AuthContext } from '@/lib/auth/authorization'
import { FUNDO_ATIVO_COOKIE } from '@/lib/fundos/fundo-ativo'

export type ContextoFundoGestor = {
  fundoId: string
  fundoNome: string
  fundoCnpj: string | null
  perfilNoFundo: string
}

type UsuarioFundoRow = {
  fundo_id: string
  perfil_no_fundo: string
  status: string
  fundos: {
    id: string
    nome: string
    cnpj: string | null
    ativo: boolean | null
  } | null
}

/**
 * Resolve o fundo a partir do cookie HttpOnly e o revalida contra
 * usuario_fundos. O contexto autenticado e recebido para evitar uma segunda
 * leitura de sessao/perfil no mesmo request.
 */
export async function resolverContextoFundoGestor(
  auth: AuthContext,
): Promise<ContextoFundoGestor> {
  if (auth.profile.status !== 'ativo') {
    throw new Error('O perfil do gestor nao esta ativo.')
  }

  const fundoId = (await cookies()).get(FUNDO_ATIVO_COOKIE)?.value
  if (!fundoId) throw new Error('Selecione um fundo ativo para continuar.')

  const { data, error } = await auth.supabase
    .from('usuario_fundos')
    .select('fundo_id, perfil_no_fundo, status, fundos(id, nome, cnpj, ativo)')
    .eq('usuario_id', auth.user.id)
    .eq('fundo_id', fundoId)
    .eq('status', 'ativo')
    .maybeSingle()

  if (error) {
    throw new Error(`Nao foi possivel validar o fundo ativo: ${error.message}`)
  }

  const row = data as unknown as UsuarioFundoRow | null
  if (!row?.fundos || row.fundos.ativo === false) {
    throw new Error('O fundo ativo nao esta autorizado para este gestor.')
  }

  return {
    fundoId: row.fundo_id,
    fundoNome: row.fundos.nome,
    fundoCnpj: row.fundos.cnpj,
    perfilNoFundo: row.perfil_no_fundo,
  }
}
