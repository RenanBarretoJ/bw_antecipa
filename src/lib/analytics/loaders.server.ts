import 'server-only'

import { requireGestor, requireRole } from '@/lib/auth/authorization'
import { resolverCedenteFundoAtivo } from '@/lib/fundos/cedente-fundo'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { buildOffsetRange, buildPaginatedResult } from '@/lib/pagination'
import type {
  CedenteDashboardData,
  ConsultorDashboardData,
  ConsultorRelatorioData,
  ConsultorRelatorioLinha,
  ConsultorRelatorioResumo,
  GestorDashboardData,
  GestorRelatorioData,
  GestorRelatorioLinha,
  GestorRelatorioResumo,
  RelatorioFiltros,
} from './contracts'

type RelatorioRpcResult<TResumo, TLinha> = {
  resumo: TResumo
  total: number
  items: TLinha[]
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Resposta analitica invalida em ${context}.`)
  }
  return value as Record<string, unknown>
}

function asRelatorioResult<TResumo, TLinha>(
  value: unknown,
  context: string,
): RelatorioRpcResult<TResumo, TLinha> {
  const record = asRecord(value, context)
  if (!record.resumo || !Array.isArray(record.items) || typeof record.total !== 'number') {
    throw new Error(`Contrato analitico incompleto em ${context}.`)
  }
  return record as RelatorioRpcResult<TResumo, TLinha>
}

export async function carregarDashboardGestor(): Promise<GestorDashboardData> {
  const auth = await requireGestor()
  const fundo = await resolverContextoFundoGestor(auth)
  const { data, error } = await auth.supabase.rpc('dashboard_gestor_resumo', {
    p_fundo_id: fundo.fundoId,
  })

  if (error) throw new Error(`Nao foi possivel carregar o dashboard do gestor: ${error.message}`)

  return {
    fundo: { id: fundo.fundoId, nome: fundo.fundoNome },
    ...asRecord(data, 'dashboard do gestor'),
  } as GestorDashboardData
}

export async function carregarDashboardCedente(): Promise<CedenteDashboardData> {
  const auth = await requireRole('cedente')
  const { data: cedente, error: cedenteError } = await auth.supabase
    .from('cedentes')
    .select('id')
    .eq('user_id', auth.user.id)
    .maybeSingle()

  if (cedenteError) throw new Error(`Nao foi possivel resolver o cedente autenticado: ${cedenteError.message}`)
  if (!cedente) throw new Error('Cedente autenticado nao encontrado.')

  const contexto = await resolverCedenteFundoAtivo(cedente.id, auth.supabase)
  if (!contexto.cedenteFundo || !contexto.fundo) {
    throw new Error('O cedente nao possui fundo operacional ativo.')
  }

  const { data, error } = await auth.supabase.rpc('dashboard_cedente_resumo', {
    p_cedente_fundo_id: contexto.cedenteFundo.id,
  })

  if (error) throw new Error(`Nao foi possivel carregar o dashboard do cedente: ${error.message}`)
  return asRecord(data, 'dashboard do cedente') as CedenteDashboardData
}

export async function carregarDashboardConsultor(): Promise<ConsultorDashboardData> {
  const auth = await requireRole('consultor')
  const { data, error } = await auth.supabase.rpc('dashboard_consultor_resumo')

  if (error) throw new Error(`Nao foi possivel carregar o dashboard do consultor: ${error.message}`)
  return asRecord(data, 'dashboard do consultor') as ConsultorDashboardData
}

function gestorReportArgs(fundoId: string, filtros: RelatorioFiltros) {
  return {
    p_fundo_id: fundoId,
    p_mes: filtros.mes,
    p_busca: filtros.q || null,
    p_status: filtros.status,
    p_cedente_id: filtros.cedenteId,
    p_data_inicial: filtros.dataInicial,
    p_data_final: filtros.dataFinal,
    p_offset: buildOffsetRange(filtros).from,
    p_page_size: filtros.pageSize,
    p_sort: filtros.sort,
    p_direction: filtros.direction,
  }
}

function consultorReportArgs(filtros: RelatorioFiltros) {
  return {
    p_mes: filtros.mes,
    p_busca: filtros.q || null,
    p_status: filtros.status,
    p_cedente_id: filtros.cedenteId,
    p_data_inicial: filtros.dataInicial,
    p_data_final: filtros.dataFinal,
    p_offset: buildOffsetRange(filtros).from,
    p_page_size: filtros.pageSize,
    p_sort: filtros.sort,
    p_direction: filtros.direction,
  }
}

export async function carregarRelatorioGestor(
  filtros: RelatorioFiltros,
): Promise<GestorRelatorioData> {
  const auth = await requireGestor()
  const fundo = await resolverContextoFundoGestor(auth)
  const { data, error } = await auth.supabase.rpc(
    'relatorio_gestor_analitico',
    gestorReportArgs(fundo.fundoId, filtros),
  )

  if (error) throw new Error(`Nao foi possivel carregar o relatorio do gestor: ${error.message}`)
  let result = asRelatorioResult<GestorRelatorioResumo, GestorRelatorioLinha>(
    data,
    'relatorio do gestor',
  )
  let tabela = buildPaginatedResult(result.items, {
    page: filtros.page,
    pageSize: filtros.pageSize,
    total: result.total,
  })

  if (tabela.pagination.wasPageAdjusted && result.total > 0) {
    const adjusted = { ...filtros, page: tabela.pagination.page }
    const retry = await auth.supabase.rpc(
      'relatorio_gestor_analitico',
      gestorReportArgs(fundo.fundoId, adjusted),
    )
    if (retry.error) throw new Error(`Nao foi possivel ajustar a pagina do relatorio: ${retry.error.message}`)
    result = asRelatorioResult<GestorRelatorioResumo, GestorRelatorioLinha>(
      retry.data,
      'relatorio do gestor',
    )
    tabela = buildPaginatedResult(result.items, {
      page: adjusted.page,
      pageSize: adjusted.pageSize,
      total: result.total,
    })
  }

  return {
    fundo: { id: fundo.fundoId, nome: fundo.fundoNome },
    filtros,
    resumo: result.resumo,
    tabela,
  }
}

export async function carregarRelatorioConsultor(
  filtros: RelatorioFiltros,
): Promise<ConsultorRelatorioData> {
  const auth = await requireRole('consultor')
  const { data, error } = await auth.supabase.rpc(
    'relatorio_consultor_analitico',
    consultorReportArgs(filtros),
  )

  if (error) throw new Error(`Nao foi possivel carregar o relatorio do consultor: ${error.message}`)
  let result = asRelatorioResult<ConsultorRelatorioResumo, ConsultorRelatorioLinha>(
    data,
    'relatorio do consultor',
  )
  let tabela = buildPaginatedResult(result.items, {
    page: filtros.page,
    pageSize: filtros.pageSize,
    total: result.total,
  })

  if (tabela.pagination.wasPageAdjusted && result.total > 0) {
    const adjusted = { ...filtros, page: tabela.pagination.page }
    const retry = await auth.supabase.rpc(
      'relatorio_consultor_analitico',
      consultorReportArgs(adjusted),
    )
    if (retry.error) throw new Error(`Nao foi possivel ajustar a pagina do relatorio: ${retry.error.message}`)
    result = asRelatorioResult<ConsultorRelatorioResumo, ConsultorRelatorioLinha>(
      retry.data,
      'relatorio do consultor',
    )
    tabela = buildPaginatedResult(result.items, {
      page: adjusted.page,
      pageSize: adjusted.pageSize,
      total: result.total,
    })
  }

  return { filtros, resumo: result.resumo, tabela }
}
