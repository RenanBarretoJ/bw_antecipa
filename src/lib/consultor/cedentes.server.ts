import { assertRole, requireAuthenticated } from '@/lib/auth/authorization'
import type { CedenteGerenciado, FundoCriacaoCedente } from '@/lib/consultor/cedentes'

export async function listarFundosCriacaoCedenteConsultor(): Promise<FundoCriacaoCedente[]> {
  const context = await requireAuthenticated()
  assertRole(context.profile.role, ['consultor'])
  const { data, error } = await context.supabase.rpc('listar_fundos_criacao_cedente_consultor')
  if (error) throw new Error('Não foi possível carregar os fundos autorizados.')
  return (data || []) as FundoCriacaoCedente[]
}

export async function listarCedentesGerenciadosConsultor(input: {
  termo?: string
  pagina?: number
  porPagina?: number
}): Promise<{ itens: CedenteGerenciado[]; total: number; pagina: number; porPagina: number }> {
  const context = await requireAuthenticated()
  assertRole(context.profile.role, ['consultor'])
  const pagina = Math.max(1, input.pagina || 1)
  const porPagina = Math.min(50, Math.max(1, input.porPagina || 10))
  const { data, error } = await context.supabase.rpc('listar_cedentes_gerenciados_consultor', {
    p_termo: input.termo?.trim().slice(0, 120) || null,
    p_limite: porPagina,
    p_offset: (pagina - 1) * porPagina,
  })
  if (error) throw new Error('Não foi possível carregar a carteira de Cedentes.')
  const itens = (data || []) as CedenteGerenciado[]
  return { itens, total: Number(itens[0]?.total_count || 0), pagina, porPagina }
}
