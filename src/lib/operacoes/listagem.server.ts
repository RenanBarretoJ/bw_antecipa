import 'server-only'

import { buildPaginatedResult, buildPaginationMeta } from '@/lib/pagination'
import { assertRole, requireAuthenticated, type AppSupabaseClient } from '@/lib/auth/authorization'
import { obterFundoAtivoAutorizado } from '@/lib/fundos/fundo-ativo.server'
import { resolverCedenteFundoAtivo } from '@/lib/fundos/cedente-fundo'
import {
  calcularMetricasPaginaOperacoes,
  intervaloOperacoes,
  type FiltrosOperacoes,
  type OperacaoListagemItem,
} from './listagem'

export type PerfilListagemOperacoes = 'gestor' | 'cedente' | 'consultor'

export type ResultadoListagemOperacoes = ReturnType<typeof buildPaginatedResult<OperacaoListagemItem>> & {
  metricasPagina: ReturnType<typeof calcularMetricasPaginaOperacoes>
}

type Escopo = {
  cedenteIds?: string[]
  cedenteFundoIds?: string[]
}

type OperacaoRow = {
  id: string
  cedente_id: string
  cedente_fundo_id: string | null
  valor_bruto_total: number
  taxa_desconto: number | null
  prazo_dias: number
  valor_liquido_desembolso: number | null
  data_vencimento: string
  status: string
  created_at: string
  aprovado_em: string | null
  aceite_sacado_exigido: boolean | null
  aceite_sacado_status: string | null
  cedentes: { razao_social: string; cnpj: string } | Array<{ razao_social: string; cnpj: string }> | null
}

const SELECT_OPERACOES = `
  id,
  cedente_id,
  cedente_fundo_id,
  valor_bruto_total,
  taxa_desconto,
  prazo_dias,
  valor_liquido_desembolso,
  data_vencimento,
  status,
  created_at,
  aprovado_em,
  aceite_sacado_exigido,
  aceite_sacado_status,
  cedentes(razao_social, cnpj)
` as const

function buscaPostgrestSegura(value: string) {
  return value.replace(/[,%().'"\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function resolverEscopo(
  perfil: PerfilListagemOperacoes,
  client: AppSupabaseClient,
  userId: string,
): Promise<Escopo> {
  if (perfil === 'gestor') {
    const fundo = await obterFundoAtivoAutorizado()
    if (!fundo.fundoId) return { cedenteFundoIds: [] }
    const { data, error } = await client
      .from('cedente_fundos')
      .select('id')
      .eq('fundo_id', fundo.fundoId)
    if (error) throw new Error(`Nao foi possivel resolver os vinculos do fundo ativo: ${error.message}`)
    return { cedenteFundoIds: (data || []).map((item) => item.id) }
  }

  if (perfil === 'cedente') {
    const { data, error } = await client
      .from('cedentes')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new Error(`Nao foi possivel resolver o cedente autenticado: ${error.message}`)
    if (!data) return { cedenteIds: [] }
    const contexto = await resolverCedenteFundoAtivo(data.id, client)
    if (!contexto.cedenteFundo || !contexto.fundo) return { cedenteIds: [] }
    return {
      cedenteIds: [data.id],
      cedenteFundoIds: [contexto.cedenteFundo.id],
    }
  }

  const { data, error } = await client
    .from('consultor_cedente')
    .select('cedente_id')
    .eq('consultor_id', userId)
  if (error) throw new Error(`Nao foi possivel resolver a carteira do consultor: ${error.message}`)
  return { cedenteIds: (data || []).map((item) => item.cedente_id) }
}

async function resolverCedentesDaBusca(
  client: AppSupabaseClient,
  busca: string,
  escopo: Escopo,
) {
  if (!busca) return null
  const termo = buscaPostgrestSegura(busca)
  if (!termo) return null
  const digitos = termo.replace(/\D/g, '')
  let query = client
    .from('cedentes')
    .select('id')
    .or([
      `razao_social.ilike.%${termo}%`,
      digitos ? `cnpj.ilike.%${digitos}%` : '',
    ].filter(Boolean).join(','))
  if (escopo.cedenteIds) {
    if (!escopo.cedenteIds.length) return []
    query = query.in('id', escopo.cedenteIds)
  }
  const { data, error } = await query
  if (error) throw new Error(`Nao foi possivel pesquisar cedentes: ${error.message}`)
  return (data || []).map((item) => item.id)
}

function aplicarFiltros(
  client: AppSupabaseClient,
  filtros: FiltrosOperacoes,
  escopo: Escopo,
  cedentesBusca: string[] | null,
) {
  let query = client.from('operacoes').select(SELECT_OPERACOES, { count: 'exact' })
  if (escopo.cedenteFundoIds) query = query.in('cedente_fundo_id', escopo.cedenteFundoIds)
  if (escopo.cedenteIds) query = query.in('cedente_id', escopo.cedenteIds)
  if (filtros.status) query = query.eq('status', filtros.status)
  if (Number.isFinite(filtros.valorMin)) query = query.gte('valor_bruto_total', Number(filtros.valorMin))
  if (Number.isFinite(filtros.valorMax)) query = query.lte('valor_bruto_total', Number(filtros.valorMax))
  if (filtros.aprovadoDe) query = query.gte('aprovado_em', filtros.aprovadoDe)
  if (filtros.aprovadoAte) query = query.lte('aprovado_em', `${filtros.aprovadoAte}T23:59:59.999Z`)
  if (filtros.busca) {
    const idExato = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(filtros.busca) ? filtros.busca : null
    const ids = cedentesBusca || []
    const condicoes = [
      idExato ? `id.eq.${idExato}` : '',
      ids.length ? `cedente_id.in.(${ids.join(',')})` : '',
    ].filter(Boolean)
    if (!condicoes.length) return null
    query = query.or(condicoes.join(','))
  }
  return query
}

function mapRow(row: OperacaoRow): OperacaoListagemItem {
  const cedente = Array.isArray(row.cedentes) ? row.cedentes[0] : row.cedentes
  return {
    id: row.id,
    cedenteId: row.cedente_id,
    cedenteFundoId: row.cedente_fundo_id,
    cedenteNome: cedente?.razao_social || 'Cedente nao informado',
    cedenteCnpj: cedente?.cnpj || '',
    valorBruto: Number(row.valor_bruto_total || 0),
    taxaDesconto: row.taxa_desconto === null ? null : Number(row.taxa_desconto),
    prazoDias: Number(row.prazo_dias || 0),
    valorLiquido: row.valor_liquido_desembolso === null ? null : Number(row.valor_liquido_desembolso),
    vencimento: row.data_vencimento,
    status: row.status,
    criadoEm: row.created_at,
    aprovadoEm: row.aprovado_em,
    aceiteSacadoExigido: row.aceite_sacado_exigido,
    aceiteSacadoStatus: row.aceite_sacado_status,
  }
}

export async function carregarOperacoesPaginadas(
  perfil: PerfilListagemOperacoes,
  filtros: FiltrosOperacoes,
): Promise<ResultadoListagemOperacoes> {
  const auth = await requireAuthenticated()
  assertRole(auth.profile.role, [perfil])
  const escopo = await resolverEscopo(perfil, auth.supabase, auth.user.id)
  if (escopo.cedenteFundoIds?.length === 0 || escopo.cedenteIds?.length === 0) {
    const vazio = buildPaginatedResult([], { page: filtros.pagina, pageSize: filtros.limite, total: 0 })
    return { ...vazio, metricasPagina: calcularMetricasPaginaOperacoes([]) }
  }

  const cedentesBusca = await resolverCedentesDaBusca(auth.supabase, filtros.busca, escopo)
  let query = aplicarFiltros(auth.supabase, filtros, escopo, cedentesBusca)
  if (!query) {
    const vazio = buildPaginatedResult([], { page: filtros.pagina, pageSize: filtros.limite, total: 0 })
    return { ...vazio, metricasPagina: calcularMetricasPaginaOperacoes([]) }
  }

  let range = intervaloOperacoes(filtros)
  let result = await query
    .order(filtros.ordenacao, { ascending: filtros.direcao === 'asc' })
    .order('id', { ascending: filtros.direcao === 'asc' })
    .range(range.from, range.to)
  if (result.error) throw new Error(`Nao foi possivel carregar as operacoes: ${result.error.message}`)

  const total = result.count || 0
  const meta = buildPaginationMeta({
    page: filtros.pagina,
    pageSize: filtros.limite,
    total,
    currentItemCount: result.data?.length || 0,
  })
  if (meta.wasPageAdjusted && total > 0) {
    const ajustados = { ...filtros, pagina: meta.page }
    query = aplicarFiltros(auth.supabase, ajustados, escopo, cedentesBusca)
    if (query) {
      range = intervaloOperacoes(ajustados)
      result = await query
        .order(filtros.ordenacao, { ascending: filtros.direcao === 'asc' })
        .order('id', { ascending: filtros.direcao === 'asc' })
        .range(range.from, range.to)
      if (result.error) throw new Error(`Nao foi possivel ajustar a pagina das operacoes: ${result.error.message}`)
    }
  }

  const itens = ((result.data || []) as unknown as OperacaoRow[]).map(mapRow)
  const paginado = buildPaginatedResult(itens, {
    page: meta.page,
    pageSize: filtros.limite,
    total,
  })
  return {
    ...paginado,
    metricasPagina: calcularMetricasPaginaOperacoes(itens),
  }
}
