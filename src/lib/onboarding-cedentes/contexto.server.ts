import 'server-only'

import { cookies } from 'next/headers'
import type { AuthContext } from '@/lib/auth/authorization'
import { FUNDO_ATIVO_COOKIE } from '@/lib/fundos/fundo-ativo'
import type { FundoOnboardingResumo } from './listagem'

type UsuarioFundoRow = {
  fundo_id: string
  principal: boolean
  perfil_no_fundo: string
  fundos: FundoOnboardingResumo | FundoOnboardingResumo[] | null
}

function fundoDaRelacao(value: UsuarioFundoRow['fundos']) {
  return Array.isArray(value) ? value[0] || null : value
}

export async function resolverFundoAtivoOnboarding(
  context: AuthContext,
): Promise<FundoOnboardingResumo | null> {
  const { data, error } = await context.supabase
    .from('usuario_fundos')
    .select('fundo_id, principal, perfil_no_fundo, fundos(id, nome, cnpj)')
    .eq('usuario_id', context.user.id)
    .eq('status', 'ativo')
    .order('principal', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Nao foi possivel resolver o fundo ativo: ${error.message}`)

  const autorizados = ((data || []) as unknown as UsuarioFundoRow[])
    .filter((row) => ['administrador', 'gestor', 'operador', 'plataforma'].includes(row.perfil_no_fundo))
    .map((row) => ({ row, fundo: fundoDaRelacao(row.fundos) }))
    .filter((item): item is { row: UsuarioFundoRow; fundo: FundoOnboardingResumo } => Boolean(item.fundo))

  const cookieFundoId = (await cookies()).get(FUNDO_ATIVO_COOKIE)?.value
  return autorizados.find((item) => item.fundo.id === cookieFundoId)?.fundo
    || autorizados.find((item) => item.row.principal)?.fundo
    || autorizados[0]?.fundo
    || null
}

