import { assertRole, requireAuthenticated } from '@/lib/auth/authorization'
import type { CedenteGerenciado, FundoCriacaoCedente } from '@/lib/consultor/cedentes'
import { podeGerenciarCarteiraConsultor } from '@/lib/consultor/membership'
import { carregarMembershipConsultorAtiva } from '@/lib/consultor/membership.server'

export async function listarFundosCriacaoCedenteConsultor(): Promise<FundoCriacaoCedente[]> {
  const context = await requireAuthenticated()
  assertRole(context.profile.role, ['consultor'])
  const membership = await carregarMembershipConsultorAtiva(context)
  if (!podeGerenciarCarteiraConsultor(membership.papel)) {
    throw new Error('Seu perfil possui acesso somente para leitura.')
  }
  const { data, error } = await context.supabase.rpc('listar_fundos_criacao_cedente_consultor')
  if (error) throw new Error('Não foi possível carregar os fundos autorizados.')
  return (data || []) as FundoCriacaoCedente[]
}

export async function listarCedentesGerenciadosConsultor(input: {
  termo?: string
  pagina?: number
  porPagina?: number
}): Promise<{
  itens: CedenteGerenciado[]
  total: number
  pagina: number
  porPagina: number
  podeGerenciar: boolean
}> {
  const context = await requireAuthenticated()
  assertRole(context.profile.role, ['consultor'])
  const membership = await carregarMembershipConsultorAtiva(context)
  const podeGerenciar = podeGerenciarCarteiraConsultor(membership.papel)
  const pagina = Math.max(1, input.pagina || 1)
  const porPagina = Math.min(50, Math.max(1, input.porPagina || 10))
  const rpc = podeGerenciar
    ? 'listar_cedentes_gerenciados_consultor'
    : 'listar_cedentes_visiveis_consultor'
  const { data, error } = await context.supabase.rpc(rpc, {
    p_termo: input.termo?.trim().slice(0, 120) || null,
    p_limite: porPagina,
    p_offset: (pagina - 1) * porPagina,
  })
  if (error) throw new Error('Não foi possível carregar a carteira de Cedentes.')
  const itens = (data || []) as CedenteGerenciado[]
  return {
    itens,
    total: Number(itens[0]?.total_count || 0),
    pagina,
    porPagina,
    podeGerenciar,
  }
}
