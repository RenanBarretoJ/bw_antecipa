import 'server-only'

import { buildPaginatedResult, buildPaginationMeta } from '@/lib/pagination'
import { assertRole, requireAuthenticated, type AppSupabaseClient } from '@/lib/auth/authorization'
import { obterFundoAtivoAutorizado } from '@/lib/fundos/fundo-ativo.server'
import { CedenteFundoError, resolverCedenteFundoAtivo } from '@/lib/fundos/cedente-fundo'
import { obterPoliticaAplicavelAoCedenteFundo } from '@/lib/operacoes/politica'
import {
  carregarVisaoExposicaoFundoCanonica,
  carregarVisaoExposicaoFundoPadraoCanonica,
} from '@/lib/financeiro/risco/visao-operacional.server'
import type { VisaoExposicaoOperacional } from '@/lib/financeiro/risco/visao-operacional'
import {
  calcularMetricasPaginaOperacoes,
  intervaloOperacoes,
  type FiltrosOperacoes,
  type OperacaoListagemItem,
} from './listagem'

export type PerfilListagemOperacoes = 'gestor' | 'cedente' | 'consultor'

export type ResultadoListagemOperacoes = ReturnType<typeof buildPaginatedResult<OperacaoListagemItem>> & {
  metricasPagina: ReturnType<typeof calcularMetricasPaginaOperacoes>
  exposicaoLogistica: VisaoExposicaoOperacional | null
  contextoConsultor: {
    possuiCedentesOperacionais: boolean
    cedenteSelecionado: { id: string; razaoSocial: string; nomeFantasia: string | null; cnpj: string } | null
    fundos: Array<{ id: string; nome: string }>
  } | null
}

type Escopo = {
  cedenteIds?: string[]
  cedenteFundoIds?: string[]
  cedenteId?: string
  cedenteFundoId?: string
  fundoId?: string
  fundoNome?: string
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
  updated_at: string
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
  updated_at,
  cedentes(razao_social, cnpj)
` as const

function buscaPostgrestSegura(value: string) {
  return value.replace(/[,%().'"\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function resolverEscopo(
  perfil: PerfilListagemOperacoes,
  auth: Awaited<ReturnType<typeof requireAuthenticated>>,
): Promise<Escopo> {
  const client = auth.supabase
  if (perfil === 'gestor') {
    const fundo = await obterFundoAtivoAutorizado()
    if (!fundo.fundoId) return { cedenteFundoIds: [] }
    const [vinculosResult, fundoResult] = await Promise.all([
      client.from('cedente_fundos').select('id').eq('fundo_id', fundo.fundoId),
      client.from('fundos').select('id,nome').eq('id', fundo.fundoId).maybeSingle(),
    ])
    if (vinculosResult.error) throw new Error(`Nao foi possivel resolver os vinculos do fundo ativo: ${vinculosResult.error.message}`)
    if (fundoResult.error || !fundoResult.data) throw new Error('Nao foi possivel resolver os dados do fundo ativo.')
    return {
      cedenteFundoIds: (vinculosResult.data || []).map((item) => item.id),
      fundoId: fundo.fundoId,
      fundoNome: fundoResult.data.nome,
    }
  }

  if (perfil === 'cedente') {
    // get_user_cedente_id() resolve tanto o dono (cedentes.user_id) quanto
    // um usuario convidado via cedente_acessos -- filtrar so por user_id
    // fazia um usuario convidado sempre ver a lista vazia.
    const { data: cedenteId } = await client.rpc('get_user_cedente_id')
    const { data, error } = cedenteId
      ? await client.from('cedentes').select('id').eq('id', cedenteId).maybeSingle()
      : { data: null, error: null }
    if (error) throw new Error(`Nao foi possivel resolver o cedente autenticado: ${error.message}`)
    if (!data) return { cedenteIds: [] }
    const contexto = await resolverCedenteFundoAtivo(data.id, client)
    if (!contexto.cedenteFundo || !contexto.fundo) return { cedenteIds: [] }
    return {
      cedenteIds: [data.id],
      cedenteFundoIds: [contexto.cedenteFundo.id],
      cedenteId: data.id,
      cedenteFundoId: contexto.cedenteFundo.id,
      fundoId: contexto.fundo.id,
      fundoNome: contexto.fundo.nome,
    }
  }

  return {}
}

async function carregarContextoConsultor(
  client: AppSupabaseClient,
  filtros: FiltrosOperacoes,
): Promise<ResultadoListagemOperacoes['contextoConsultor']> {
  const [fundosResult, permissaoCedenteResult] = await Promise.all([
    client.rpc('listar_fundos_operacionais_consultor'),
    filtros.cedenteId
      ? client.rpc('consultor_pode_operar_cedente', { p_cedente_id: filtros.cedenteId })
      : Promise.resolve({ data: null, error: null }),
  ])
  if (fundosResult.error) throw new Error(`Nao foi possivel carregar os fundos da carteira: ${fundosResult.error.message}`)
  if (permissaoCedenteResult.error) throw new Error(`Nao foi possivel validar o Cedente filtrado: ${permissaoCedenteResult.error.message}`)

  let cedenteSelecionado: NonNullable<ResultadoListagemOperacoes['contextoConsultor']>['cedenteSelecionado'] = null
  if (filtros.cedenteId && permissaoCedenteResult.data === true) {
    const { data, error } = await client
      .from('cedentes')
      .select('id,razao_social,nome_fantasia,cnpj')
      .eq('id', filtros.cedenteId)
      .eq('status', 'ativo')
      .maybeSingle()
    if (error) throw new Error(`Nao foi possivel carregar o Cedente filtrado: ${error.message}`)
    if (data) {
      cedenteSelecionado = {
        id: data.id,
        razaoSocial: data.razao_social,
        nomeFantasia: data.nome_fantasia,
        cnpj: data.cnpj,
      }
    }
  }

  const fundos = (fundosResult.data || []).map((item) => ({ id: item.id, nome: item.nome }))
  return {
    possuiCedentesOperacionais: fundos.length > 0,
    cedenteSelecionado,
    fundos,
  }
}

async function aplicarEscopoConsultor(
  client: AppSupabaseClient,
  filtros: FiltrosOperacoes,
  escopo: Escopo,
) {
  if (!filtros.fundoId) return escopo
  const { data, error } = await client
    .from('cedente_fundos')
    .select('id')
    .eq('fundo_id', filtros.fundoId)
    .eq('status', 'ativo')
  if (error) throw new Error(`Nao foi possivel aplicar o filtro de Fundo: ${error.message}`)
  return { ...escopo, cedenteFundoIds: (data || []).map((item) => item.id) }
}

async function carregarExposicaoListagem(
  perfil: PerfilListagemOperacoes,
  escopo: Escopo,
  client: AppSupabaseClient,
): Promise<VisaoExposicaoOperacional | null> {
  if (!escopo.fundoId || !escopo.fundoNome) return null
  if (perfil === 'gestor') {
    return carregarVisaoExposicaoFundoPadraoCanonica({
      fundoId: escopo.fundoId,
      fundoNome: escopo.fundoNome,
    })
  }
  if (perfil !== 'cedente' || !escopo.cedenteId || !escopo.cedenteFundoId) return null

  try {
    const politica = await obterPoliticaAplicavelAoCedenteFundo({
      cedenteId: escopo.cedenteId,
      cedenteFundoId: escopo.cedenteFundoId,
      fundoId: escopo.fundoId,
    }, client)
    return carregarVisaoExposicaoFundoCanonica({
      fundoId: escopo.fundoId,
      fundoNome: escopo.fundoNome,
      politicaVersao: politica.versao,
    })
  } catch (error) {
    if (error instanceof CedenteFundoError && error.code === 'POLITICA_CONTEXT_NOT_CONFIGURED') return null
    throw error
  }
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
  if (filtros.solicitadoDe) query = query.gte('created_at', filtros.solicitadoDe)
  if (filtros.solicitadoAte) query = query.lte('created_at', `${filtros.solicitadoAte}T23:59:59.999Z`)
  if (filtros.cedenteId) query = query.eq('cedente_id', filtros.cedenteId)
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

function mapRow(
  row: OperacaoRow,
  quantidadeNfs: Map<string, number>,
  fundosPorVinculo: Map<string, { id: string; nome: string }>,
): OperacaoListagemItem {
  const cedente = Array.isArray(row.cedentes) ? row.cedentes[0] : row.cedentes
  const fundo = row.cedente_fundo_id ? fundosPorVinculo.get(row.cedente_fundo_id) : null
  return {
    id: row.id,
    cedenteId: row.cedente_id,
    cedenteFundoId: row.cedente_fundo_id,
    cedenteNome: cedente?.razao_social || 'Cedente nao informado',
    cedenteCnpj: cedente?.cnpj || '',
    fundoId: fundo?.id || null,
    fundoNome: fundo?.nome || 'Fundo nao informado',
    quantidadeNfs: quantidadeNfs.get(row.id) || 0,
    valorBruto: Number(row.valor_bruto_total || 0),
    taxaDesconto: row.taxa_desconto === null ? null : Number(row.taxa_desconto),
    prazoDias: Number(row.prazo_dias || 0),
    valorLiquido: row.valor_liquido_desembolso === null ? null : Number(row.valor_liquido_desembolso),
    vencimento: row.data_vencimento,
    status: row.status,
    criadoEm: row.created_at,
    atualizadoEm: row.updated_at,
    aprovadoEm: row.aprovado_em,
    aceiteSacadoExigido: row.aceite_sacado_exigido,
    aceiteSacadoStatus: row.aceite_sacado_status,
  }
}

async function mapRowsComRelacionamentos(
  client: AppSupabaseClient,
  rows: OperacaoRow[],
) {
  if (!rows.length) return []
  const operacaoIds = rows.map((row) => row.id)
  const vinculoIds = rows.flatMap((row) => row.cedente_fundo_id ? [row.cedente_fundo_id] : [])
  const [linksResult, vinculosResult] = await Promise.all([
    client.from('operacoes_nfs').select('operacao_id').in('operacao_id', operacaoIds),
    vinculoIds.length
      ? client.from('cedente_fundos').select('id,fundo_id').in('id', vinculoIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (linksResult.error) throw new Error(`Nao foi possivel contar as NFs das operacoes: ${linksResult.error.message}`)
  if (vinculosResult.error) throw new Error(`Nao foi possivel resolver os Fundos das operacoes: ${vinculosResult.error.message}`)

  const quantidadeNfs = new Map<string, number>()
  for (const link of linksResult.data || []) {
    quantidadeNfs.set(link.operacao_id, (quantidadeNfs.get(link.operacao_id) || 0) + 1)
  }
  const vinculos = vinculosResult.data || []
  const fundoIds = Array.from(new Set(vinculos.map((item) => item.fundo_id)))
  const fundosResult = fundoIds.length
    ? await client.from('fundos').select('id,nome').in('id', fundoIds)
    : { data: [], error: null }
  if (fundosResult.error) throw new Error(`Nao foi possivel carregar os Fundos das operacoes: ${fundosResult.error.message}`)
  const fundosPorId = new Map((fundosResult.data || []).map((item) => [item.id, item.nome]))
  const fundosPorVinculo = new Map(vinculos.map((item) => [
    item.id,
    { id: item.fundo_id, nome: fundosPorId.get(item.fundo_id) || 'Fundo nao informado' },
  ]))
  return rows.map((row) => mapRow(row, quantidadeNfs, fundosPorVinculo))
}

export async function carregarOperacoesPaginadas(
  perfil: PerfilListagemOperacoes,
  filtros: FiltrosOperacoes,
): Promise<ResultadoListagemOperacoes> {
  const auth = await requireAuthenticated()
  assertRole(auth.profile.role, [perfil])
  let escopo = await resolverEscopo(perfil, auth)
  const contextoConsultor = perfil === 'consultor'
    ? await carregarContextoConsultor(auth.supabase, filtros)
    : null
  if (perfil === 'consultor') escopo = await aplicarEscopoConsultor(auth.supabase, filtros, escopo)
  const exposicaoLogistica = await carregarExposicaoListagem(perfil, escopo, auth.supabase)
  if (escopo.cedenteFundoIds?.length === 0 || escopo.cedenteIds?.length === 0) {
    const vazio = buildPaginatedResult([], { page: filtros.pagina, pageSize: filtros.limite, total: 0 })
    return { ...vazio, metricasPagina: calcularMetricasPaginaOperacoes([]), exposicaoLogistica, contextoConsultor }
  }

  const cedentesBusca = await resolverCedentesDaBusca(auth.supabase, filtros.busca, escopo)
  let query = aplicarFiltros(auth.supabase, filtros, escopo, cedentesBusca)
  if (!query) {
    const vazio = buildPaginatedResult([], { page: filtros.pagina, pageSize: filtros.limite, total: 0 })
    return { ...vazio, metricasPagina: calcularMetricasPaginaOperacoes([]), exposicaoLogistica, contextoConsultor }
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

  const itens = await mapRowsComRelacionamentos(auth.supabase, (result.data || []) as unknown as OperacaoRow[])
  const paginado = buildPaginatedResult(itens, {
    page: meta.page,
    pageSize: filtros.limite,
    total,
  })
  return {
    ...paginado,
    metricasPagina: calcularMetricasPaginaOperacoes(itens),
    exposicaoLogistica,
    contextoConsultor,
  }
}
