import 'server-only'

import { obterFundoAtivoAutorizado } from '@/lib/actions/fundo-ativo'
import { requireGestor } from '@/lib/auth/authorization'
import type {
  RlxConciliacaoExecucao,
  RlxConciliacaoResultado,
  RlxMatchingCandidato,
  RlxMatchingExecucao,
  RlxMatchingResultado,
  RlxPosicaoLogisticaExecucao,
  RlxPosicaoLogisticaResultado,
  RlxTituloNfVinculo,
} from '@/types/database'

export type ConciliacaoTab = 'visao-geral' | 'matching' | 'conciliacao' | 'logistica' | 'excecoes'

export type ConciliacaoFilters = {
  tab: ConciliacaoTab
  dataReferencia: string
  status: string
  metodo: string
  q: string
  cedente: string
  sacado: string
  notaFiscal: string
  seuNumero: string
  idRecebivel: string
  vencimentoDe: string
  vencimentoAte: string
  page: number
  pageSize: number
}

export type MatchingViewRow = RlxMatchingResultado & {
  candidatos: Array<RlxMatchingCandidato & { notaFiscal?: Record<string, unknown> | null }>
  vinculo?: RlxTituloNfVinculo | null
}

export type ConciliacaoDashboard = {
  fundo: { id: string; nome: string }
  filtros: ConciliacaoFilters
  datasDisponiveis: string[]
  matchingExecucao: RlxMatchingExecucao | null
  conciliacaoExecucao: RlxConciliacaoExecucao | null
  logisticaExecucao: RlxPosicaoLogisticaExecucao | null
  matching: { rows: MatchingViewRow[]; total: number }
  conciliacao: { rows: RlxConciliacaoResultado[]; total: number }
  logistica: { rows: RlxPosicaoLogisticaResultado[]; total: number }
}

const MATCH_EXCEPTIONS: readonly RlxMatchingResultado['status'][] = ['AMBIGUO', 'NAO_CONCILIADO', 'CONFLITO']
const MATCH_STATUSES: readonly RlxMatchingResultado['status'][] = ['MATCH_FORTE', ...MATCH_EXCEPTIONS]
const RECON_EXCEPTIONS = [
  'DIVERGENCIA_VALOR',
  'ENTRADA_NAO_INCORPORADA',
  'ENTRADA_SEM_AQUISICAO',
  'SAIDA_SEM_LIQUIDACAO',
  'LIQUIDADO_AINDA_NO_ESTOQUE',
  'NAO_CONCILIADO',
]

function safeSearch(value: string) {
  return value.replace(/[,%()]/g, ' ').trim().slice(0, 120)
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function gestorContext() {
  const [context, active] = await Promise.all([requireGestor(), obterFundoAtivoAutorizado()])
  if (!active.fundoId) throw new Error('Nenhum fundo ativo autorizado foi encontrado.')
  const { data: fundo, error } = await context.supabase
    .from('fundos')
    .select('id,nome')
    .eq('id', active.fundoId)
    .single()
  if (error || !fundo) throw new Error('O fundo ativo nao esta disponivel para conciliacao.')
  return { context, fundo: { id: String(fundo.id), nome: String(fundo.nome) } }
}

async function availableDates(
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'],
  fundoId: string,
) {
  const [matching, reconciliation, logistics] = await Promise.all([
    supabase.from('rlx_matching_execucoes').select('data_referencia').eq('fundo_id', fundoId).order('data_referencia', { ascending: false }).limit(60),
    supabase.from('rlx_conciliacao_execucoes').select('data_referencia').eq('fundo_id', fundoId).order('data_referencia', { ascending: false }).limit(60),
    supabase.from('rlx_posicao_logistica_execucoes').select('data_referencia').eq('fundo_id', fundoId).order('data_referencia', { ascending: false }).limit(60),
  ])
  if (matching.error) throw new Error(`Nao foi possivel consultar as datas de matching: ${matching.error.message}`)
  if (reconciliation.error) throw new Error(`Nao foi possivel consultar as datas de conciliacao: ${reconciliation.error.message}`)
  if (logistics.error) throw new Error(`Nao foi possivel consultar as datas logisticas: ${logistics.error.message}`)
  return [...new Set([...(matching.data || []), ...(reconciliation.data || []), ...(logistics.data || [])].map((row) => String(row.data_referencia)))].sort().reverse()
}

async function latestExecutions(
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'],
  fundoId: string,
  dataReferencia: string,
) {
  let matching = supabase.from('rlx_matching_execucoes').select('*').eq('fundo_id', fundoId).order('created_at', { ascending: false }).limit(1)
  let reconciliation = supabase.from('rlx_conciliacao_execucoes').select('*').eq('fundo_id', fundoId).order('created_at', { ascending: false }).limit(1)
  let logistics = supabase.from('rlx_posicao_logistica_execucoes').select('*').eq('fundo_id', fundoId).order('created_at', { ascending: false }).limit(1)
  if (dataReferencia) {
    matching = matching.eq('data_referencia', dataReferencia)
    reconciliation = reconciliation.eq('data_referencia', dataReferencia)
    logistics = logistics.eq('data_referencia', dataReferencia)
  }
  const [matchingResult, reconciliationResult, logisticsResult] = await Promise.all([matching.maybeSingle(), reconciliation.maybeSingle(), logistics.maybeSingle()])
  if (matchingResult.error) throw new Error(`Nao foi possivel carregar a execucao de matching: ${matchingResult.error.message}`)
  if (reconciliationResult.error) throw new Error(`Nao foi possivel carregar a execucao de conciliacao: ${reconciliationResult.error.message}`)
  if (logisticsResult.error) throw new Error(`Nao foi possivel carregar a execucao logistica: ${logisticsResult.error.message}`)
  return {
    matching: matchingResult.data as RlxMatchingExecucao | null,
    reconciliation: reconciliationResult.data as RlxConciliacaoExecucao | null,
    logistics: logisticsResult.data as RlxPosicaoLogisticaExecucao | null,
  }
}

async function logisticsRows(input: {
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase']
  fundoId: string
  executionId: string | null
  filters: ConciliacaoFilters
}) {
  if (!input.executionId) return { rows: [], total: 0 }
  if (input.filters.notaFiscal && !isUuid(input.filters.notaFiscal)) return { rows: [], total: 0 }
  const from = (input.filters.page - 1) * input.filters.pageSize
  let query = input.supabase.from('rlx_posicao_logistica_resultados').select('*', { count: 'exact' })
    .eq('fundo_id', input.fundoId).eq('execucao_id', input.executionId)
    .order('criado_em', { ascending: false }).range(from, from + input.filters.pageSize - 1)
  if (input.filters.tab === 'excecoes') {
    query = query.or('status_vinculo.eq.SEM_MATCH_FINANCEIRO_NF,status_logistico.eq.INDETERMINADA,valor_aquisicao_qualidade.eq.AUSENTE,nf_compartilhada_entre_posicoes.eq.true')
  } else if (input.filters.status) {
    if (input.filters.status === 'SEM_MATCH_FINANCEIRO_NF') query = query.eq('status_vinculo', 'SEM_MATCH_FINANCEIRO_NF')
    else if (MATCH_STATUSES.includes(input.filters.status as RlxMatchingResultado['status'])) query = query.eq('matching_status', input.filters.status as RlxMatchingResultado['status'])
    else query = query.eq('status_logistico', input.filters.status as Exclude<RlxPosicaoLogisticaResultado['status_logistico'], null>)
  }
  if (input.filters.metodo) query = query.eq('matching_metodo', input.filters.metodo)
  const q = safeSearch(input.filters.q)
  if (q) query = query.or(`id_recebivel.ilike.%${q}%,seu_numero.ilike.%${q}%,numero_documento.ilike.%${q}%,cedente_nome.ilike.%${q}%,sacado_nome.ilike.%${q}%`)
  if (input.filters.cedente) query = query.ilike('cedente_nome', `%${safeSearch(input.filters.cedente)}%`)
  if (input.filters.sacado) query = query.ilike('sacado_nome', `%${safeSearch(input.filters.sacado)}%`)
  if (input.filters.notaFiscal) query = query.eq('nota_fiscal_id', input.filters.notaFiscal)
  if (input.filters.seuNumero) query = query.ilike('seu_numero', `%${safeSearch(input.filters.seuNumero)}%`)
  if (input.filters.idRecebivel) query = query.ilike('id_recebivel', `%${safeSearch(input.filters.idRecebivel)}%`)
  if (input.filters.vencimentoDe) query = query.gte('data_vencimento', input.filters.vencimentoDe)
  if (input.filters.vencimentoAte) query = query.lte('data_vencimento', input.filters.vencimentoAte)
  const { data, error, count } = await query
  if (error) throw new Error(`Nao foi possivel listar a posicao logistica: ${error.message}`)
  return { rows: (data || []) as RlxPosicaoLogisticaResultado[], total: count || 0 }
}

async function matchingRows(input: {
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase']
  fundoId: string
  executionId: string | null
  filters: ConciliacaoFilters
}) {
  if (!input.executionId) return { rows: [], total: 0 }
  const from = (input.filters.page - 1) * input.filters.pageSize
  const to = from + input.filters.pageSize - 1
  let query = input.supabase
    .from('rlx_matching_resultados')
    .select('*', { count: 'exact' })
    .eq('fundo_id', input.fundoId)
    .eq('execucao_id', input.executionId)
    .order('criado_em', { ascending: false })
    .range(from, to)
  if (input.filters.tab === 'excecoes') query = query.in('status', MATCH_EXCEPTIONS)
  else if (input.filters.status) query = query.eq('status', input.filters.status as RlxMatchingResultado['status'])
  if (input.filters.metodo) query = query.eq('metodo', input.filters.metodo as RlxMatchingResultado['metodo'])
  const q = safeSearch(input.filters.q)
  if (q) query = query.or(`identidade_externa.ilike.%${q}%,cedente_nome.ilike.%${q}%,sacado_nome.ilike.%${q}%,numero_documento.ilike.%${q}%,chave_nfe.ilike.%${q}%`)
  const { data, error, count } = await query
  if (error) throw new Error(`Nao foi possivel listar os resultados de matching: ${error.message}`)
  const rows = (data || []) as RlxMatchingResultado[]
  const resultIds = rows.map((row) => row.id)
  const linkIds = rows.map((row) => row.vinculo_id).filter((value): value is string => Boolean(value))
  const [candidates, links] = await Promise.all([
    resultIds.length
      ? input.supabase.from('rlx_matching_candidatos').select('*').in('matching_resultado_id', resultIds).order('ordem')
      : Promise.resolve({ data: [], error: null }),
    linkIds.length
      ? input.supabase.from('rlx_titulo_nf_vinculos').select('*').in('id', linkIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (candidates.error) throw new Error(`Nao foi possivel carregar as candidatas: ${candidates.error.message}`)
  if (links.error) throw new Error(`Nao foi possivel carregar os vinculos: ${links.error.message}`)
  const candidateRows = (candidates.data || []) as RlxMatchingCandidato[]
  const noteIds = [...new Set(candidateRows.map((row) => row.nota_fiscal_id))]
  const notes = noteIds.length
    ? await input.supabase.from('notas_fiscais').select('id,numero_nf,razao_social_emitente,cnpj_emitente,razao_social_destinatario,cnpj_destinatario,data_vencimento,valor_bruto').eq('fundo_id', input.fundoId).in('id', noteIds)
    : { data: [], error: null }
  if (notes.error) throw new Error(`Nao foi possivel carregar as NFs candidatas: ${notes.error.message}`)
  const noteById = new Map((notes.data || []).map((note) => [String(note.id), note as Record<string, unknown>]))
  const linkById = new Map(((links.data || []) as RlxTituloNfVinculo[]).map((link) => [link.id, link]))
  return {
    total: count || 0,
    rows: rows.map((row): MatchingViewRow => ({
      ...row,
      candidatos: candidateRows
        .filter((candidate) => candidate.matching_resultado_id === row.id)
        .map((candidate) => ({ ...candidate, notaFiscal: noteById.get(candidate.nota_fiscal_id) || null })),
      vinculo: row.vinculo_id ? linkById.get(row.vinculo_id) || null : null,
    })),
  }
}

async function reconciliationRows(input: {
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase']
  fundoId: string
  executionId: string | null
  filters: ConciliacaoFilters
}) {
  if (!input.executionId) return { rows: [], total: 0 }
  const from = (input.filters.page - 1) * input.filters.pageSize
  const to = from + input.filters.pageSize - 1
  let query = input.supabase
    .from('rlx_conciliacao_resultados')
    .select('*', { count: 'exact' })
    .eq('fundo_id', input.fundoId)
    .eq('execucao_id', input.executionId)
    .order('criado_em', { ascending: false })
    .range(from, to)
  if (input.filters.tab === 'excecoes') query = query.in('status', RECON_EXCEPTIONS)
  else if (input.filters.status) query = query.eq('status', input.filters.status)
  const q = safeSearch(input.filters.q)
  if (q) query = query.ilike('identidade_externa', `%${q}%`)
  const { data, error, count } = await query
  if (error) throw new Error(`Nao foi possivel listar a conciliacao: ${error.message}`)
  return { rows: (data || []) as RlxConciliacaoResultado[], total: count || 0 }
}

export async function carregarConciliacaoGestor(filters: ConciliacaoFilters): Promise<ConciliacaoDashboard> {
  const { context, fundo } = await gestorContext()
  const dates = await availableDates(context.supabase, fundo.id)
  const requestedDate = filters.dataReferencia || dates[0] || ''
  const executions = await latestExecutions(context.supabase, fundo.id, requestedDate)
  const normalizedFilters = { ...filters, dataReferencia: requestedDate }
  const [matching, reconciliation, logistics] = await Promise.all([
    matchingRows({ supabase: context.supabase, fundoId: fundo.id, executionId: executions.matching?.id || null, filters: normalizedFilters }),
    reconciliationRows({ supabase: context.supabase, fundoId: fundo.id, executionId: executions.reconciliation?.id || null, filters: normalizedFilters }),
    logisticsRows({ supabase: context.supabase, fundoId: fundo.id, executionId: executions.logistics?.id || null, filters: normalizedFilters }),
  ])
  return {
    fundo,
    filtros: normalizedFilters,
    datasDisponiveis: dates,
    matchingExecucao: executions.matching,
    conciliacaoExecucao: executions.reconciliation,
    logisticaExecucao: executions.logistics,
    matching,
    conciliacao: reconciliation,
    logistica: logistics,
  }
}
