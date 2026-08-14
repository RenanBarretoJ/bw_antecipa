import 'server-only'

import { obterFundoAtivoAutorizado } from '@/lib/actions/fundo-ativo'
import { requireGestor } from '@/lib/auth/authorization'
import type {
  ConciliacaoExecucao,
  ConciliacaoResultado,
  MatchingCandidato,
  MatchingExecucao,
  MatchingResultado,
  PosicaoLogisticaExecucao,
  PosicaoLogisticaResultado,
  ExposicaoExecucao,
  ExposicaoOverlayItem,
  RiscoExecucao,
  RiscoMotivo,
  RiscoRevisao,
  TituloNfVinculo,
} from '@/types/database'

export type ConciliacaoTab = 'visao-geral' | 'matching' | 'conciliacao' | 'logistica' | 'exposicao' | 'risco' | 'excecoes'

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
  riskReason: string
  riskOperation: string
  riskPolicy: string
  riskCreatedFrom: string
  riskCreatedTo: string
  page: number
  pageSize: number
}

export type MatchingViewRow = MatchingResultado & {
  candidatos: Array<MatchingCandidato & { notaFiscal?: Record<string, unknown> | null }>
  vinculo?: TituloNfVinculo | null
}

export type ConciliacaoDashboard = {
  fundo: { id: string; nome: string }
  filtros: ConciliacaoFilters
  datasDisponiveis: string[]
  matchingExecucao: MatchingExecucao | null
  conciliacaoExecucao: ConciliacaoExecucao | null
  logisticaExecucao: PosicaoLogisticaExecucao | null
  exposicaoExecucao: ExposicaoExecucao | null
  riscoExecucao: RiscoExecucao | null
  matching: { rows: MatchingViewRow[]; total: number }
  conciliacao: { rows: ConciliacaoResultado[]; total: number }
  logistica: { rows: PosicaoLogisticaResultado[]; total: number }
  exposicao: { rows: ExposicaoOverlayItem[]; total: number }
  risco: {
    rows: Array<RiscoExecucao & { motivos: RiscoMotivo[]; revisao: RiscoRevisao | null }>
    total: number
    revisoesPendentes: number
    operacoesBloqueadas: number
  }
}

const MATCH_EXCEPTIONS: readonly MatchingResultado['status'][] = ['AMBIGUO', 'NAO_CONCILIADO', 'CONFLITO']
const MATCH_STATUSES: readonly MatchingResultado['status'][] = ['MATCH_FORTE', ...MATCH_EXCEPTIONS]
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
  const [matching, reconciliation, logistics, exposure, risk] = await Promise.all([
    supabase.from('matching_execucoes').select('data_referencia').eq('fundo_id', fundoId).order('data_referencia', { ascending: false }).limit(60),
    supabase.from('conciliacao_execucoes').select('data_referencia').eq('fundo_id', fundoId).order('data_referencia', { ascending: false }).limit(60),
    supabase.from('posicao_logistica_execucoes').select('data_referencia').eq('fundo_id', fundoId).order('data_referencia', { ascending: false }).limit(60),
    supabase.from('exposicao_execucoes').select('data_operacional').eq('fundo_id', fundoId).order('data_operacional', { ascending: false }).limit(60),
    supabase.from('risco_execucoes').select('data_operacional').eq('fundo_id', fundoId).order('data_operacional', { ascending: false }).limit(60),
  ])
  if (matching.error) throw new Error(`Nao foi possivel consultar as datas de matching: ${matching.error.message}`)
  if (reconciliation.error) throw new Error(`Nao foi possivel consultar as datas de conciliacao: ${reconciliation.error.message}`)
  if (logistics.error) throw new Error(`Nao foi possivel consultar as datas logisticas: ${logistics.error.message}`)
  if (exposure.error) throw new Error(`Nao foi possivel consultar as datas de exposicao: ${exposure.error.message}`)
  if (risk.error) throw new Error(`Nao foi possivel consultar as datas de risco: ${risk.error.message}`)
  return [...new Set([
    ...(matching.data || []).map((row) => String(row.data_referencia)),
    ...(reconciliation.data || []).map((row) => String(row.data_referencia)),
    ...(logistics.data || []).map((row) => String(row.data_referencia)),
    ...(exposure.data || []).map((row) => String(row.data_operacional)),
    ...(risk.data || []).map((row) => String(row.data_operacional)),
  ])].sort().reverse()
}

async function latestExecutions(
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'],
  fundoId: string,
  dataReferencia: string,
) {
  let matching = supabase.from('matching_execucoes').select('*').eq('fundo_id', fundoId).order('created_at', { ascending: false }).limit(1)
  let reconciliation = supabase.from('conciliacao_execucoes').select('*').eq('fundo_id', fundoId).order('created_at', { ascending: false }).limit(1)
  let logistics = supabase.from('posicao_logistica_execucoes').select('*').eq('fundo_id', fundoId).order('created_at', { ascending: false }).limit(1)
  let exposure = supabase.from('exposicao_execucoes').select('*').eq('fundo_id', fundoId).order('created_at', { ascending: false }).limit(1)
  let risk = supabase.from('risco_execucoes').select('*').eq('fundo_id', fundoId).order('created_at', { ascending: false }).limit(1)
  if (dataReferencia) {
    matching = matching.eq('data_referencia', dataReferencia)
    reconciliation = reconciliation.eq('data_referencia', dataReferencia)
    logistics = logistics.eq('data_referencia', dataReferencia)
    exposure = exposure.eq('data_operacional', dataReferencia)
    risk = risk.eq('data_operacional', dataReferencia)
  }
  const [matchingResult, reconciliationResult, logisticsResult, exposureResult, riskResult] = await Promise.all([matching.maybeSingle(), reconciliation.maybeSingle(), logistics.maybeSingle(), exposure.maybeSingle(), risk.maybeSingle()])
  if (matchingResult.error) throw new Error(`Nao foi possivel carregar a execucao de matching: ${matchingResult.error.message}`)
  if (reconciliationResult.error) throw new Error(`Nao foi possivel carregar a execucao de conciliacao: ${reconciliationResult.error.message}`)
  if (logisticsResult.error) throw new Error(`Nao foi possivel carregar a execucao logistica: ${logisticsResult.error.message}`)
  if (exposureResult.error) throw new Error(`Nao foi possivel carregar a execucao de exposicao: ${exposureResult.error.message}`)
  if (riskResult.error) throw new Error(`Nao foi possivel carregar a execucao de risco: ${riskResult.error.message}`)
  return {
    matching: matchingResult.data as MatchingExecucao | null,
    reconciliation: reconciliationResult.data as ConciliacaoExecucao | null,
    logistics: logisticsResult.data as PosicaoLogisticaExecucao | null,
    exposure: exposureResult.data as ExposicaoExecucao | null,
    risk: riskResult.data as RiscoExecucao | null,
  }
}

async function riskRows(input: {
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase']
  fundoId: string
  filters: ConciliacaoFilters
}) {
  let reasonExecutionIds: string[] | null = null
  if (input.filters.riskReason) {
    const reasons = await input.supabase.from('risco_motivos').select('risco_execucao_id')
      .eq('fundo_id', input.fundoId).eq('codigo', input.filters.riskReason as RiscoMotivo['codigo'])
    if (reasons.error) throw new Error(`Nao foi possivel filtrar os motivos de risco: ${reasons.error.message}`)
    reasonExecutionIds = [...new Set((reasons.data || []).map((row) => String(row.risco_execucao_id)))]
  }

  let cedenteOperationIds: string[] | null = null
  const cedenteSearch = safeSearch(input.filters.cedente)
  if (cedenteSearch) {
    const cedentes = await input.supabase.from('cedentes').select('id')
      .or(`razao_social.ilike.%${cedenteSearch}%,nome_fantasia.ilike.%${cedenteSearch}%,cnpj.ilike.%${cedenteSearch}%`)
    if (cedentes.error) throw new Error(`Nao foi possivel filtrar o cedente no risco: ${cedentes.error.message}`)
    const cedenteIds = (cedentes.data || []).map((row) => String(row.id))
    const links = cedenteIds.length
      ? await input.supabase.from('cedente_fundos').select('id').eq('fundo_id', input.fundoId).in('cedente_id', cedenteIds)
      : { data: [], error: null }
    if (links.error) throw new Error(`Nao foi possivel resolver os vinculos do cedente no risco: ${links.error.message}`)
    const linkIds = (links.data || []).map((row) => String(row.id))
    const operations = linkIds.length
      ? await input.supabase.from('operacoes').select('id').in('cedente_fundo_id', linkIds)
      : { data: [], error: null }
    if (operations.error) throw new Error(`Nao foi possivel resolver as operacoes do cedente no risco: ${operations.error.message}`)
    cedenteOperationIds = (operations.data || []).map((row) => String(row.id))
  }

  const from = (input.filters.page - 1) * input.filters.pageSize
  let query = input.supabase.from('risco_execucoes').select('*', { count: 'exact' })
    .eq('fundo_id', input.fundoId).order('created_at', { ascending: false })
    .range(from, from + input.filters.pageSize - 1)
  if (input.filters.dataReferencia) query = query.eq('data_operacional', input.filters.dataReferencia)
  if (input.filters.status) {
    if (['APTO', 'REVISAO_MANUAL', 'BLOQUEADO'].includes(input.filters.status)) query = query.eq('decisao', input.filters.status as NonNullable<RiscoExecucao['decisao']>)
    else query = query.eq('status_tecnico', input.filters.status as RiscoExecucao['status_tecnico'])
  }
  const q = safeSearch(input.filters.q)
  if (q && isUuid(q)) query = query.or(`id.eq.${q},operacao_id.eq.${q},correlation_id.eq.${q}`)
  if (reasonExecutionIds) {
    if (!reasonExecutionIds.length) return emptyRiskResult(input)
    query = query.in('id', reasonExecutionIds)
  }
  if (cedenteOperationIds) {
    if (!cedenteOperationIds.length) return emptyRiskResult(input)
    query = query.in('operacao_id', cedenteOperationIds)
  }
  if (input.filters.riskOperation) {
    if (!isUuid(input.filters.riskOperation)) return emptyRiskResult(input)
    query = query.eq('operacao_id', input.filters.riskOperation)
  }
  if (input.filters.riskPolicy) {
    if (!isUuid(input.filters.riskPolicy)) return emptyRiskResult(input)
    query = query.eq('politica_operacional_versao_id', input.filters.riskPolicy)
  }
  if (input.filters.riskCreatedFrom) query = query.gte('created_at', `${input.filters.riskCreatedFrom}T00:00:00.000Z`)
  if (input.filters.riskCreatedTo) query = query.lte('created_at', `${input.filters.riskCreatedTo}T23:59:59.999Z`)
  const [{ data, error, count }, pendingReviews, blockedOperations] = await Promise.all([
    query,
    input.supabase.from('risco_revisoes').select('id', { count: 'exact', head: true })
      .eq('fundo_id', input.fundoId).eq('status', 'PENDENTE'),
    input.supabase.from('risco_execucoes').select('id', { count: 'exact', head: true })
      .eq('fundo_id', input.fundoId).eq('escopo', 'OPERACAO').eq('decisao', 'BLOQUEADO'),
  ])
  if (error) throw new Error(`Nao foi possivel listar as avaliacoes de risco: ${error.message}`)
  if (pendingReviews.error) throw new Error(`Nao foi possivel contar as revisoes pendentes: ${pendingReviews.error.message}`)
  if (blockedOperations.error) throw new Error(`Nao foi possivel contar as operacoes bloqueadas: ${blockedOperations.error.message}`)
  const rows = (data || []) as RiscoExecucao[]
  const ids = rows.map((row) => row.id)
  const [reasons, reviews] = ids.length ? await Promise.all([
    input.supabase.from('risco_motivos').select('*').eq('fundo_id', input.fundoId).in('risco_execucao_id', ids).order('created_at'),
    input.supabase.from('risco_revisoes').select('*').eq('fundo_id', input.fundoId).in('risco_execucao_id', ids),
  ]) : [{ data: [], error: null }, { data: [], error: null }]
  if (reasons.error) throw new Error(`Nao foi possivel carregar os motivos de risco: ${reasons.error.message}`)
  if (reviews.error) throw new Error(`Nao foi possivel carregar as revisoes de risco: ${reviews.error.message}`)
  const reasonRows = (reasons.data || []) as RiscoMotivo[]
  const reviewRows = (reviews.data || []) as RiscoRevisao[]
  return {
    total: count || 0,
    revisoesPendentes: pendingReviews.count || 0,
    operacoesBloqueadas: blockedOperations.count || 0,
    rows: rows.map((row) => ({
      ...row,
      motivos: reasonRows.filter((reason) => reason.risco_execucao_id === row.id),
      revisao: reviewRows.find((review) => review.risco_execucao_id === row.id) || null,
    })),
  }
}

async function emptyRiskResult(input: {
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase']
  fundoId: string
}) {
  const [pendingReviews, blockedOperations] = await Promise.all([
    input.supabase.from('risco_revisoes').select('id', { count: 'exact', head: true })
      .eq('fundo_id', input.fundoId).eq('status', 'PENDENTE'),
    input.supabase.from('risco_execucoes').select('id', { count: 'exact', head: true })
      .eq('fundo_id', input.fundoId).eq('escopo', 'OPERACAO').eq('decisao', 'BLOQUEADO'),
  ])
  if (pendingReviews.error) throw new Error(`Nao foi possivel contar as revisoes pendentes: ${pendingReviews.error.message}`)
  if (blockedOperations.error) throw new Error(`Nao foi possivel contar as operacoes bloqueadas: ${blockedOperations.error.message}`)
  return { rows: [], total: 0, revisoesPendentes: pendingReviews.count || 0, operacoesBloqueadas: blockedOperations.count || 0 }
}

async function exposureRows(input: {
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase']
  fundoId: string
  executionId: string | null
  filters: ConciliacaoFilters
}) {
  if (!input.executionId) return { rows: [], total: 0 }
  const from = (input.filters.page - 1) * input.filters.pageSize
  let query = input.supabase.from('exposicao_overlay_itens').select('*', { count: 'exact' })
    .eq('fundo_id', input.fundoId).eq('execucao_id', input.executionId)
    .order('created_at', { ascending: false }).range(from, from + input.filters.pageSize - 1)
  if (input.filters.status) query = query.eq('motivo', input.filters.status as ExposicaoOverlayItem['motivo'])
  const q = safeSearch(input.filters.q)
  if (q && isUuid(q)) query = query.or(`operacao_id.eq.${q},nota_fiscal_id.eq.${q}`)
  const { data, error, count } = await query
  if (error) throw new Error(`Nao foi possivel listar o overlay de exposicao: ${error.message}`)
  return { rows: (data || []) as ExposicaoOverlayItem[], total: count || 0 }
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
  let query = input.supabase.from('posicao_logistica_resultados').select('*', { count: 'exact' })
    .eq('fundo_id', input.fundoId).eq('execucao_id', input.executionId)
    .order('criado_em', { ascending: false }).range(from, from + input.filters.pageSize - 1)
  if (input.filters.tab === 'excecoes') {
    query = query.or('status_vinculo.eq.SEM_MATCH_FINANCEIRO_NF,status_logistico.eq.INDETERMINADA,valor_aquisicao_qualidade.eq.AUSENTE,nf_compartilhada_entre_posicoes.eq.true')
  } else if (input.filters.status) {
    if (input.filters.status === 'SEM_MATCH_FINANCEIRO_NF') query = query.eq('status_vinculo', 'SEM_MATCH_FINANCEIRO_NF')
    else if (MATCH_STATUSES.includes(input.filters.status as MatchingResultado['status'])) query = query.eq('matching_status', input.filters.status as MatchingResultado['status'])
    else query = query.eq('status_logistico', input.filters.status as Exclude<PosicaoLogisticaResultado['status_logistico'], null>)
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
  return { rows: (data || []) as PosicaoLogisticaResultado[], total: count || 0 }
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
    .from('matching_resultados')
    .select('*', { count: 'exact' })
    .eq('fundo_id', input.fundoId)
    .eq('execucao_id', input.executionId)
    .order('criado_em', { ascending: false })
    .range(from, to)
  if (input.filters.tab === 'excecoes') query = query.in('status', MATCH_EXCEPTIONS)
  else if (input.filters.status) query = query.eq('status', input.filters.status as MatchingResultado['status'])
  if (input.filters.metodo) query = query.eq('metodo', input.filters.metodo as MatchingResultado['metodo'])
  const q = safeSearch(input.filters.q)
  if (q) query = query.or(`identidade_externa.ilike.%${q}%,cedente_nome.ilike.%${q}%,sacado_nome.ilike.%${q}%,numero_documento.ilike.%${q}%,chave_nfe.ilike.%${q}%`)
  const { data, error, count } = await query
  if (error) throw new Error(`Nao foi possivel listar os resultados de matching: ${error.message}`)
  const rows = (data || []) as MatchingResultado[]
  const resultIds = rows.map((row) => row.id)
  const linkIds = rows.map((row) => row.vinculo_id).filter((value): value is string => Boolean(value))
  const [candidates, links] = await Promise.all([
    resultIds.length
      ? input.supabase.from('matching_candidatos').select('*').in('matching_resultado_id', resultIds).order('ordem')
      : Promise.resolve({ data: [], error: null }),
    linkIds.length
      ? input.supabase.from('titulo_nf_vinculos').select('*').in('id', linkIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (candidates.error) throw new Error(`Nao foi possivel carregar as candidatas: ${candidates.error.message}`)
  if (links.error) throw new Error(`Nao foi possivel carregar os vinculos: ${links.error.message}`)
  const candidateRows = (candidates.data || []) as MatchingCandidato[]
  const noteIds = [...new Set(candidateRows.map((row) => row.nota_fiscal_id))]
  const notes = noteIds.length
    ? await input.supabase.from('notas_fiscais').select('id,numero_nf,razao_social_emitente,cnpj_emitente,razao_social_destinatario,cnpj_destinatario,data_vencimento,valor_bruto').eq('fundo_id', input.fundoId).in('id', noteIds)
    : { data: [], error: null }
  if (notes.error) throw new Error(`Nao foi possivel carregar as NFs candidatas: ${notes.error.message}`)
  const noteById = new Map((notes.data || []).map((note) => [String(note.id), note as Record<string, unknown>]))
  const linkById = new Map(((links.data || []) as TituloNfVinculo[]).map((link) => [link.id, link]))
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
    .from('conciliacao_resultados')
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
  return { rows: (data || []) as ConciliacaoResultado[], total: count || 0 }
}

export async function carregarConciliacaoGestor(filters: ConciliacaoFilters): Promise<ConciliacaoDashboard> {
  const { context, fundo } = await gestorContext()
  const dates = await availableDates(context.supabase, fundo.id)
  const requestedDate = filters.dataReferencia || dates[0] || ''
  const executions = await latestExecutions(context.supabase, fundo.id, requestedDate)
  const normalizedFilters = { ...filters, dataReferencia: requestedDate }
  const [matching, reconciliation, logistics, exposure, risk] = await Promise.all([
    matchingRows({ supabase: context.supabase, fundoId: fundo.id, executionId: executions.matching?.id || null, filters: normalizedFilters }),
    reconciliationRows({ supabase: context.supabase, fundoId: fundo.id, executionId: executions.reconciliation?.id || null, filters: normalizedFilters }),
    logisticsRows({ supabase: context.supabase, fundoId: fundo.id, executionId: executions.logistics?.id || null, filters: normalizedFilters }),
    exposureRows({ supabase: context.supabase, fundoId: fundo.id, executionId: executions.exposure?.id || null, filters: normalizedFilters }),
    riskRows({ supabase: context.supabase, fundoId: fundo.id, filters: normalizedFilters }),
  ])
  return {
    fundo,
    filtros: normalizedFilters,
    datasDisponiveis: dates,
    matchingExecucao: executions.matching,
    conciliacaoExecucao: executions.reconciliation,
    logisticaExecucao: executions.logistics,
    exposicaoExecucao: executions.exposure,
    riscoExecucao: executions.risk,
    matching,
    conciliacao: reconciliation,
    logistica: logistics,
    exposicao: exposure,
    risco: risk,
  }
}
