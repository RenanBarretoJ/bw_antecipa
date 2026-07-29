import 'server-only'

import { requireGestor } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import {
  buildOffsetRange,
  buildPaginatedResult,
  buildPaginationMeta,
} from '@/lib/pagination'
import {
  calcularMetricasPaginaDocumentosGestor,
  type DocumentoGestorListagemItem,
  type FiltrosDocumentosGestor,
  type ResultadoDocumentosGestor,
} from './gestor-listagem'

const TIPO_LABELS: Record<string, string> = {
  contrato_social: 'Contrato Social',
  cartao_cnpj: 'Cartao CNPJ',
  rg_cpf: 'RG e CPF',
  comprovante_endereco: 'Comprovante de Endereco',
  extrato_bancario: 'Comprovante de Renda',
  balanco_patrimonial: 'Balanco Patrimonial',
  dre: 'DRE',
  procuracao: 'Procuracao',
}

type DocumentoRow = {
  id: string
  cedente_id: string
  tipo: string
  versao: number
  status: string
  nome_arquivo: string | null
  analisado_em: string | null
  created_at: string
  updated_at: string
  cedentes: { id: string; razao_social: string; cnpj: string } | null
}

async function resolverCedentesDaBusca(
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'],
  cedenteIds: string[],
  busca: string,
) {
  if (!busca || cedenteIds.length === 0) return []
  const termo = busca.replace(/[,%().'"\\]/g, ' ')
  const digitos = busca.replace(/\D/g, '')
  const condicoes = [`razao_social.ilike.%${termo}%`]
  if (digitos) condicoes.push(`cnpj.ilike.%${digitos}%`)
  const { data, error } = await supabase
    .from('cedentes')
    .select('id')
    .in('id', cedenteIds)
    .or(condicoes.join(','))
  if (error) throw new Error(`Nao foi possivel pesquisar cedentes: ${error.message}`)
  return (data || []).map((item) => item.id)
}

function tiposDaBusca(busca: string) {
  if (!busca) return []
  const termo = busca.toLocaleLowerCase('pt-BR')
  return Object.entries(TIPO_LABELS)
    .filter(([codigo, nome]) =>
      codigo.toLocaleLowerCase('pt-BR').includes(termo)
      || nome.toLocaleLowerCase('pt-BR').includes(termo))
    .map(([codigo]) => codigo)
}

function aplicarFiltros(
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'],
  filtros: FiltrosDocumentosGestor,
  cedenteIds: string[],
  cedentesBusca: string[],
  tiposBusca: string[],
) {
  let query = supabase
    .from('documentos')
    .select(`
      id,
      cedente_id,
      tipo,
      versao,
      status,
      nome_arquivo,
      analisado_em,
      created_at,
      updated_at,
      cedentes(id, razao_social, cnpj)
    `, { count: 'exact' })
    .in('cedente_id', cedenteIds)

  if (filtros.status) query = query.eq('status', filtros.status)
  if (filtros.q) {
    const condicoes = []
    if (cedentesBusca.length) condicoes.push(`cedente_id.in.(${cedentesBusca.join(',')})`)
    if (tiposBusca.length) condicoes.push(`tipo.in.(${tiposBusca.join(',')})`)
    if (condicoes.length) query = query.or(condicoes.join(','))
    else query = query.eq('id', '00000000-0000-0000-0000-000000000000')
  }
  return query
}

export async function carregarDocumentosGestorPaginados(
  filtros: FiltrosDocumentosGestor,
): Promise<ResultadoDocumentosGestor> {
  const auth = await requireGestor()
  const contexto = await resolverContextoFundoGestor(auth)
  const { data: vinculosData, error: vinculosError } = await auth.supabase
    .from('cedente_fundos')
    .select('cedente_id')
    .eq('fundo_id', contexto.fundoId)
    .eq('status', 'ativo')
  if (vinculosError) {
    throw new Error(`Nao foi possivel carregar os vinculos do fundo: ${vinculosError.message}`)
  }

  const cedenteIds = Array.from(new Set(
    (vinculosData || []).map((item) => item.cedente_id).filter(Boolean),
  ))
  if (cedenteIds.length === 0) {
    return {
      ...buildPaginatedResult([], {
        page: filtros.page,
        pageSize: filtros.pageSize,
        total: 0,
      }),
      metricasPagina: { pendentes: 0, aprovados: 0, reprovados: 0 },
    }
  }

  const [cedentesBusca, tiposBusca] = await Promise.all([
    resolverCedentesDaBusca(auth.supabase, cedenteIds, filtros.q),
    Promise.resolve(tiposDaBusca(filtros.q)),
  ])

  let range = buildOffsetRange(filtros)
  let result = await aplicarFiltros(
    auth.supabase,
    filtros,
    cedenteIds,
    cedentesBusca,
    tiposBusca,
  )
    .order(filtros.sort, { ascending: filtros.direction === 'asc' })
    .order('id', { ascending: filtros.direction === 'asc' })
    .range(range.from, range.to)

  if (result.error) {
    throw new Error(`Nao foi possivel carregar os documentos: ${result.error.message}`)
  }

  const total = result.count || 0
  const meta = buildPaginationMeta({
    page: filtros.page,
    pageSize: filtros.pageSize,
    total,
    currentItemCount: result.data?.length || 0,
  })
  if (meta.wasPageAdjusted && total > 0) {
    range = buildOffsetRange({ page: meta.page, pageSize: filtros.pageSize })
    result = await aplicarFiltros(
      auth.supabase,
      { ...filtros, page: meta.page },
      cedenteIds,
      cedentesBusca,
      tiposBusca,
    )
      .order(filtros.sort, { ascending: filtros.direction === 'asc' })
      .order('id', { ascending: filtros.direction === 'asc' })
      .range(range.from, range.to)
    if (result.error) {
      throw new Error(`Nao foi possivel ajustar a pagina dos documentos: ${result.error.message}`)
    }
  }

  const items = ((result.data || []) as unknown as DocumentoRow[]).map(
    (row): DocumentoGestorListagemItem => ({
      id: row.id,
      tipo: row.tipo,
      nome: TIPO_LABELS[row.tipo] || row.tipo,
      status: row.status,
      cedente: {
        id: row.cedente_id,
        nome: row.cedentes?.razao_social || 'Cedente nao informado',
        cnpj: row.cedentes?.cnpj || '',
      },
      versaoAtual: {
        numero: Number(row.versao || 1),
        criadoEm: row.created_at,
      },
      ultimaAnalise: row.analisado_em
        ? { resultado: row.status, analisadoEm: row.analisado_em }
        : null,
      possuiArquivo: Boolean(row.nome_arquivo),
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
  )

  return {
    ...buildPaginatedResult(items, {
      page: meta.page,
      pageSize: filtros.pageSize,
      total,
    }),
    metricasPagina: calcularMetricasPaginaDocumentosGestor(items),
  }
}
