import 'server-only'

import { cookies } from 'next/headers'
import type { AuthContext } from '@/lib/auth/authorization'
import {
  escolherFundoInicial,
  FUNDO_ATIVO_COOKIE,
  type FundoAutorizado,
} from '@/lib/fundos/fundo-ativo'

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
  principal: boolean
  fundos: {
    id: string
    nome: string
    cnpj: string | null
    ativo: boolean | null
  } | null
}

/**
 * Resolve o fundo no servidor antes de qualquer consulta dependente. O cookie
 * e apenas uma preferencia: quando ausente, invalido ou nao autorizado, a
 * selecao cai no fundo principal/primeiro fundo ativo autorizado.
 */
export async function resolverContextoFundoGestor(
  auth: AuthContext,
): Promise<ContextoFundoGestor> {
  if (auth.profile.status !== 'ativo') {
    throw new Error('O perfil do gestor nao esta ativo.')
  }

  const cookieFundoId = (await cookies()).get(FUNDO_ATIVO_COOKIE)?.value || null

  const { data, error } = await auth.supabase
    .from('usuario_fundos')
    .select('fundo_id, perfil_no_fundo, status, principal, fundos(id, nome, cnpj, ativo)')
    .eq('usuario_id', auth.user.id)
    .eq('status', 'ativo')
    .order('principal', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(`Nao foi possivel validar o fundo ativo: ${error.message}`)
  }

  const fundos = ((data || []) as unknown as UsuarioFundoRow[])
    .filter((row) => row.fundos && row.fundos.ativo !== false)
    .map((row): FundoAutorizado => ({
      id: row.fundo_id,
      nome: row.fundos?.nome || row.fundo_id,
      cnpj: row.fundos?.cnpj || null,
      status: row.status,
      perfilNoFundo: row.perfil_no_fundo,
      principal: row.principal,
    }))
  const selecionado = escolherFundoInicial({ fundos, cookieFundoId })

  if (!selecionado) throw new Error('Nenhum fundo ativo autorizado foi encontrado para este gestor.')

  return {
    fundoId: selecionado.id,
    fundoNome: selecionado.nome,
    fundoCnpj: selecionado.cnpj,
    perfilNoFundo: selecionado.perfilNoFundo,
  }
}
