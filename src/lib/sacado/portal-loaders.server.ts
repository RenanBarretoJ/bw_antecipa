import 'server-only'

import {
  buildOffsetRange,
  buildPaginatedResult,
  buildPaginationMeta,
} from '@/lib/pagination'
import { resolverContextoSacado } from './contexto.server'
import {
  calcularIndicadoresPaginaPagamentos,
  type AprovacaoSacadoItem,
  type DashboardSacado,
  type FiltrosAprovacoesSacado,
  type FiltrosNfsSacado,
  type FiltrosPagamentosSacado,
  type NotaFiscalSacadoListagemItem,
  type PagamentoSacadoItem,
  type ResultadoAprovacoesSacado,
  type ResultadoNfsSacado,
  type ResultadoPagamentosSacado,
} from './portal-listagens'
import type { OperacaoStatus } from '@/lib/types/domain'

const STATUS_OPERACAO_ACEITE = [
  'solicitada',
  'em_analise',
] as const satisfies readonly OperacaoStatus[]
const STATUS_PAGAMENTO_VALIDOS = [
  'em_andamento',
  'liquidada',
  'inadimplente',
] as const satisfies readonly OperacaoStatus[]

type NotaRow = {
  id: string
  numero_nf: string
  serie: string | null
  chave_acesso: string | null
  cedente_id: string
  cnpj_emitente: string
  razao_social_emitente: string
  valor_bruto: number
  data_emissao: string | null
  data_vencimento: string | null
  status: string
  arquivo_url: string | null
  created_at: string
}

type LinkRow = {
  nota_fiscal_id: string
  operacao_id: string
}

type OperacaoRow = {
  id: string
  status: string
  aceite_sacado_exigido: boolean | null
  aceite_sacado_status: string | null
  created_at: string
}

type AprovacaoRow = NotaRow & {
  operacoes_nfs: Array<{
    operacao_id: string
    operacoes: OperacaoRow | null
  }>
}

type PagamentoRow = {
  id: string
  cedente_id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  data_vencimento: string | null
  liquidada_em: string | null
  status: string
  created_at: string
  operacoes_nfs: Array<{
    notas_fiscais: {
      cedente_id: string
      razao_social_emitente: string
      cnpj_emitente: string
    } | null
  }>
}

function buscaSegura(value: string): { texto: string; digitos: string } {
  return {
    texto: value.replace(/[,%().'"\\]/g, ' ').trim(),
    digitos: value.replace(/\D/g, ''),
  }
}

function aplicarFiltrosNfs(
  supabase: Awaited<ReturnType<typeof resolverContextoSacado>>['auth']['supabase'],
  cnpj: string,
  filtros: FiltrosNfsSacado,
) {
  let query = supabase
    .from('notas_fiscais')
    .select(`
      id,
      numero_nf,
      serie,
      chave_acesso,
      cedente_id,
      cnpj_emitente,
      razao_social_emitente,
      valor_bruto,
      data_emissao,
      data_vencimento,
      status,
      arquivo_url,
      created_at
    `, { count: 'exact' })
    .eq('cnpj_destinatario', cnpj)

  if (filtros.status) query = query.eq('status', filtros.status)
  if (filtros.q) {
    const { texto, digitos } = buscaSegura(filtros.q)
    const condicoes = [
      `numero_nf.ilike.%${texto}%`,
      `chave_acesso.ilike.%${texto}%`,
      `razao_social_emitente.ilike.%${texto}%`,
    ]
    if (digitos) condicoes.push(`cnpj_emitente.ilike.%${digitos}%`)
    query = query.or(condicoes.join(','))
  }
  return query
}

async function carregarOperacoesDasNotas(
  supabase: Awaited<ReturnType<typeof resolverContextoSacado>>['auth']['supabase'],
  notaIds: string[],
) {
  if (notaIds.length === 0) return new Map<string, OperacaoRow & { notaFiscalId: string }>()

  const { data: linksData, error: linksError } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id, operacao_id')
    .in('nota_fiscal_id', notaIds)

  if (linksError) {
    throw new Error(`Nao foi possivel consultar os vinculos das NFs: ${linksError.message}`)
  }

  const links = (linksData || []) as LinkRow[]
  const operacaoIds = Array.from(new Set(links.map((item) => item.operacao_id)))
  if (operacaoIds.length === 0) return new Map<string, OperacaoRow & { notaFiscalId: string }>()

  const { data: operacoesData, error: operacoesError } = await supabase
    .from('operacoes')
    .select('id, status, aceite_sacado_exigido, aceite_sacado_status, created_at')
    .in('id', operacaoIds)

  if (operacoesError) {
    throw new Error(`Nao foi possivel consultar as operacoes das NFs: ${operacoesError.message}`)
  }

  const operacoes = new Map(((operacoesData || []) as OperacaoRow[]).map((item) => [item.id, item]))
  const porNota = new Map<string, OperacaoRow & { notaFiscalId: string }>()
  for (const link of links) {
    const operacao = operacoes.get(link.operacao_id)
    if (operacao && !porNota.has(link.nota_fiscal_id)) {
      porNota.set(link.nota_fiscal_id, { ...operacao, notaFiscalId: link.nota_fiscal_id })
    }
  }
  return porNota
}

export async function carregarDashboardSacado(): Promise<DashboardSacado> {
  const { auth } = await resolverContextoSacado()
  const { data, error } = await auth.supabase.rpc('carregar_dashboard_sacado')
  if (error) throw new Error(`Nao foi possivel carregar o dashboard do sacado: ${error.message}`)

  const payload = (data || {}) as unknown as DashboardSacado
  return {
    indicadores: {
      totalDevido: Number(payload.indicadores?.totalDevido || 0),
      nfsAtivas: Number(payload.indicadores?.nfsAtivas || 0),
      vencidas: Number(payload.indicadores?.vencidas || 0),
      valorVencido: Number(payload.indicadores?.valorVencido || 0),
      vencemHoje: Number(payload.indicadores?.vencemHoje || 0),
      valorVenceHoje: Number(payload.indicadores?.valorVenceHoje || 0),
      proximos7Dias: Number(payload.indicadores?.proximos7Dias || 0),
      valorProximos7Dias: Number(payload.indicadores?.valorProximos7Dias || 0),
    },
    proximosVencimentos: Array.isArray(payload.proximosVencimentos)
      ? payload.proximosVencimentos.slice(0, 8)
      : [],
    cedentesEmAberto: Array.isArray(payload.cedentesEmAberto)
      ? payload.cedentesEmAberto.slice(0, 8)
      : [],
  }
}

export async function carregarNotasFiscaisSacado(
  filtros: FiltrosNfsSacado,
): Promise<ResultadoNfsSacado> {
  const { auth, cnpj } = await resolverContextoSacado()
  let range = buildOffsetRange(filtros)
  let result = await aplicarFiltrosNfs(auth.supabase, cnpj, filtros)
    .order(filtros.sort, { ascending: filtros.direction === 'asc' })
    .order('id', { ascending: filtros.direction === 'asc' })
    .range(range.from, range.to)

  if (result.error) throw new Error(`Nao foi possivel carregar as NFs recebidas: ${result.error.message}`)

  const total = result.count || 0
  const meta = buildPaginationMeta({
    page: filtros.page,
    pageSize: filtros.pageSize,
    total,
    currentItemCount: result.data?.length || 0,
  })

  if (meta.wasPageAdjusted && total > 0) {
    range = buildOffsetRange({ page: meta.page, pageSize: filtros.pageSize })
    result = await aplicarFiltrosNfs(auth.supabase, cnpj, { ...filtros, page: meta.page })
      .order(filtros.sort, { ascending: filtros.direction === 'asc' })
      .order('id', { ascending: filtros.direction === 'asc' })
      .range(range.from, range.to)
    if (result.error) throw new Error(`Nao foi possivel ajustar a pagina das NFs: ${result.error.message}`)
  }

  const rows = (result.data || []) as unknown as NotaRow[]
  const operacoesPorNota = await carregarOperacoesDasNotas(auth.supabase, rows.map((item) => item.id))
  const items = rows.map((row): NotaFiscalSacadoListagemItem => {
    const operacao = operacoesPorNota.get(row.id)
    return {
      id: row.id,
      numero: row.numero_nf,
      serie: row.serie,
      chaveAcesso: row.chave_acesso,
      cedente: {
        id: row.cedente_id,
        nome: row.razao_social_emitente,
        cnpj: row.cnpj_emitente,
      },
      valor: Number(row.valor_bruto || 0),
      emissaoEm: row.data_emissao,
      vencimentoEm: row.data_vencimento,
      status: row.status,
      situacaoAprovacao: operacao?.aceite_sacado_status || 'nao_solicitada',
      operacao: operacao ? {
        id: operacao.id,
        codigo: operacao.id.slice(0, 8),
        status: operacao.status,
        aceiteSacadoExigido: operacao.aceite_sacado_exigido,
        aceiteSacadoStatus: operacao.aceite_sacado_status,
      } : null,
      criadoEm: row.created_at,
      possuiArquivo: Boolean(row.arquivo_url),
    }
  })

  const { data: indicadoresData, error: indicadoresError } = await auth.supabase
    .rpc('carregar_indicadores_nfs_sacado')
  if (indicadoresError) {
    throw new Error(`Nao foi possivel calcular os indicadores das NFs: ${indicadoresError.message}`)
  }
  const indicadores = (indicadoresData || {}) as Record<string, unknown>

  return {
    ...buildPaginatedResult(items, {
      page: meta.page,
      pageSize: filtros.pageSize,
      total,
    }),
    indicadores: {
      total: Number(indicadores.total || 0),
      cedidas: Number(indicadores.cedidas || 0),
      liquidadas: Number(indicadores.liquidadas || 0),
      vencidas: Number(indicadores.vencidas || 0),
    },
  }
}

function aplicarFiltrosAprovacao(
  supabase: Awaited<ReturnType<typeof resolverContextoSacado>>['auth']['supabase'],
  cnpj: string,
  filtros: FiltrosAprovacoesSacado,
) {
  let query = supabase
    .from('notas_fiscais')
    .select(`
      id,
      numero_nf,
      serie,
      chave_acesso,
      cedente_id,
      cnpj_emitente,
      razao_social_emitente,
      valor_bruto,
      data_emissao,
      data_vencimento,
      status,
      arquivo_url,
      created_at,
      operacoes_nfs!inner(
        operacao_id,
        operacoes!inner(
          id,
          status,
          aceite_sacado_exigido,
          aceite_sacado_status,
          created_at
        )
      )
    `, { count: 'exact' })
    .eq('cnpj_destinatario', cnpj)
    .eq('status', 'em_antecipacao')
    .eq('operacoes_nfs.operacoes.aceite_sacado_exigido', true)
    .eq('operacoes_nfs.operacoes.aceite_sacado_status', 'pendente')
    .in('operacoes_nfs.operacoes.status', STATUS_OPERACAO_ACEITE)

  if (filtros.cedenteId) query = query.eq('cedente_id', filtros.cedenteId)
  if (filtros.vencimentoDe) query = query.gte('data_vencimento', filtros.vencimentoDe)
  if (filtros.vencimentoAte) query = query.lte('data_vencimento', filtros.vencimentoAte)
  if (filtros.valorMinimo !== null) query = query.gte('valor_bruto', filtros.valorMinimo)
  if (filtros.valorMaximo !== null) query = query.lte('valor_bruto', filtros.valorMaximo)
  if (filtros.q) {
    const { texto, digitos } = buscaSegura(filtros.q)
    const condicoes = [
      `numero_nf.ilike.%${texto}%`,
      `razao_social_emitente.ilike.%${texto}%`,
    ]
    if (digitos) condicoes.push(`cnpj_emitente.ilike.%${digitos}%`)
    query = query.or(condicoes.join(','))
  }
  return query
}

export async function carregarAprovacoesSacado(
  filtros: FiltrosAprovacoesSacado,
): Promise<ResultadoAprovacoesSacado> {
  const { auth, cnpj } = await resolverContextoSacado()
  let range = buildOffsetRange(filtros)
  let result = await aplicarFiltrosAprovacao(auth.supabase, cnpj, filtros)
    .order(filtros.sort, { ascending: filtros.direction === 'asc' })
    .order('id', { ascending: filtros.direction === 'asc' })
    .range(range.from, range.to)

  if (result.error) throw new Error(`Nao foi possivel carregar as aprovacoes pendentes: ${result.error.message}`)

  const total = result.count || 0
  const meta = buildPaginationMeta({
    page: filtros.page,
    pageSize: filtros.pageSize,
    total,
    currentItemCount: result.data?.length || 0,
  })
  if (meta.wasPageAdjusted && total > 0) {
    range = buildOffsetRange({ page: meta.page, pageSize: filtros.pageSize })
    result = await aplicarFiltrosAprovacao(auth.supabase, cnpj, { ...filtros, page: meta.page })
      .order(filtros.sort, { ascending: filtros.direction === 'asc' })
      .order('id', { ascending: filtros.direction === 'asc' })
      .range(range.from, range.to)
    if (result.error) throw new Error(`Nao foi possivel ajustar a pagina das aprovacoes: ${result.error.message}`)
  }

  const rows = (result.data || []) as unknown as AprovacaoRow[]
  const items = rows.flatMap((row): AprovacaoSacadoItem[] => {
    const link = row.operacoes_nfs[0]
    if (!link?.operacoes) return []
    return [{
      notaFiscalId: row.id,
      numero: row.numero_nf,
      cedente: {
        id: row.cedente_id,
        nome: row.razao_social_emitente,
        cnpj: row.cnpj_emitente,
      },
      valor: Number(row.valor_bruto || 0),
      emissaoEm: row.data_emissao,
      vencimentoEm: row.data_vencimento,
      operacao: {
        id: link.operacoes.id,
        codigo: link.operacoes.id.slice(0, 8),
        contaEscrow: null,
      },
      statusAprovacao: link.operacoes.aceite_sacado_status || 'pendente',
      solicitadoEm: link.operacoes.created_at || row.created_at,
      possuiArquivo: Boolean(row.arquivo_url),
    }]
  })

  const { data: cedentesData, error: cedentesError } = await auth.supabase
    .rpc('listar_cedentes_aprovacao_sacado')
  if (cedentesError) {
    throw new Error(`Nao foi possivel carregar os cedentes das aprovacoes: ${cedentesError.message}`)
  }
  const cedentes = (Array.isArray(cedentesData) ? cedentesData : []) as Array<{
    id: string
    nome: string
    cnpj: string
  }>

  return {
    ...buildPaginatedResult(items, {
      page: meta.page,
      pageSize: filtros.pageSize,
      total,
    }),
    cedentes,
    valorPagina: items.reduce((totalValor, item) => totalValor + item.valor, 0),
  }
}

function aplicarFiltrosPagamentos(
  supabase: Awaited<ReturnType<typeof resolverContextoSacado>>['auth']['supabase'],
  cnpj: string,
  filtros: FiltrosPagamentosSacado,
) {
  let query = supabase
    .from('operacoes')
    .select(`
      id,
      cedente_id,
      valor_bruto_total,
      valor_liquido_desembolso,
      data_vencimento,
      liquidada_em,
      status,
      created_at,
      operacoes_nfs!inner(
        notas_fiscais!inner(
          cedente_id,
          razao_social_emitente,
          cnpj_emitente
        )
      )
    `, { count: 'exact' })
    .eq('operacoes_nfs.notas_fiscais.cnpj_destinatario', cnpj)
    .in('status', STATUS_PAGAMENTO_VALIDOS)

  if (filtros.status) query = query.eq('status', filtros.status)
  if (filtros.q) {
    const { texto, digitos } = buscaSegura(filtros.q)
    if (digitos) {
      query = query.ilike('operacoes_nfs.notas_fiscais.cnpj_emitente', `%${digitos}%`)
    } else {
      query = query.ilike('operacoes_nfs.notas_fiscais.razao_social_emitente', `%${texto}%`)
    }
  }
  return query
}

export async function carregarPagamentosSacado(
  filtros: FiltrosPagamentosSacado,
): Promise<ResultadoPagamentosSacado> {
  const { auth, cnpj } = await resolverContextoSacado()
  let range = buildOffsetRange(filtros)
  let result = await aplicarFiltrosPagamentos(auth.supabase, cnpj, filtros)
    .order(filtros.sort, { ascending: filtros.direction === 'asc', nullsFirst: false })
    .order('id', { ascending: filtros.direction === 'asc' })
    .range(range.from, range.to)

  if (result.error) throw new Error(`Nao foi possivel carregar os pagamentos: ${result.error.message}`)

  const total = result.count || 0
  const meta = buildPaginationMeta({
    page: filtros.page,
    pageSize: filtros.pageSize,
    total,
    currentItemCount: result.data?.length || 0,
  })
  if (meta.wasPageAdjusted && total > 0) {
    range = buildOffsetRange({ page: meta.page, pageSize: filtros.pageSize })
    result = await aplicarFiltrosPagamentos(auth.supabase, cnpj, { ...filtros, page: meta.page })
      .order(filtros.sort, { ascending: filtros.direction === 'asc', nullsFirst: false })
      .order('id', { ascending: filtros.direction === 'asc' })
      .range(range.from, range.to)
    if (result.error) throw new Error(`Nao foi possivel ajustar a pagina dos pagamentos: ${result.error.message}`)
  }

  const rows = (result.data || []) as unknown as PagamentoRow[]
  const items = rows.map((row): PagamentoSacadoItem => {
    const nota = row.operacoes_nfs.find((item) => item.notas_fiscais)?.notas_fiscais
    return {
      id: row.id,
      codigo: row.id.slice(0, 8),
      cedente: {
        id: nota?.cedente_id || row.cedente_id,
        nome: nota?.razao_social_emitente || 'Cedente nao informado',
        cnpj: nota?.cnpj_emitente || '',
      },
      valorOriginal: Number(row.valor_bruto_total || 0),
      valorLiquido: Number(row.valor_liquido_desembolso || 0),
      vencimentoEm: row.data_vencimento,
      pagoEm: row.liquidada_em,
      status: row.status,
      contaEscrow: null,
    }
  })

  return {
    ...buildPaginatedResult(items, {
      page: meta.page,
      pageSize: filtros.pageSize,
      total,
    }),
    indicadoresPagina: calcularIndicadoresPaginaPagamentos(items),
  }
}
