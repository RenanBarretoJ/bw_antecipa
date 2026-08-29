import 'server-only'

import { requireGestor } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import {
  buildOffsetRange,
  buildPaginatedResult,
  buildPaginationMeta,
} from '@/lib/pagination'
import {
  calcularMetricasPaginaNotasGestor,
  type FiltrosNotasFiscaisGestor,
  type NotaFiscalGestorListagemItem,
  type ResultadoNotasFiscaisGestor,
} from './gestor-listagem'
import { carregarResumoDocumentalDasNotas } from './resumo-documental-gestor.server'

const SELECT_NOTAS = `
  id,
  numero_nf,
  serie,
  chave_acesso,
  status,
  cedente_id,
  cnpj_emitente,
  razao_social_emitente,
  cnpj_destinatario,
  razao_social_destinatario,
  valor_bruto,
  data_emissao,
  data_vencimento,
  created_at,
  updated_at
` as const

type NotaRow = {
  id: string
  numero_nf: string
  serie: string | null
  chave_acesso: string | null
  status: NotaFiscalGestorListagemItem['status']
  cedente_id: string
  cnpj_emitente: string
  razao_social_emitente: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  data_emissao: string | null
  data_vencimento: string | null
  created_at: string
  updated_at: string
}

function aplicarFiltros(
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'],
  filtros: FiltrosNotasFiscaisGestor,
  cedenteFundoIds: string[],
) {
  let query = supabase
    .from('notas_fiscais')
    .select(SELECT_NOTAS, { count: 'exact' })
    .in('cedente_fundo_id', cedenteFundoIds)
    .neq('status', 'rascunho')

  if (filtros.status) query = query.eq('status', filtros.status)
  if (filtros.cedenteId) query = query.eq('cedente_id', filtros.cedenteId)
  if (filtros.vencimentoDe) query = query.gte('data_vencimento', filtros.vencimentoDe)
  if (filtros.vencimentoAte) query = query.lte('data_vencimento', filtros.vencimentoAte)
  if (filtros.q) {
    const q = filtros.q.replace(/[,%().'"\\]/g, ' ')
    const digitos = filtros.q.replace(/\D/g, '')
    const condicoes = [
      `numero_nf.ilike.%${q}%`,
      `chave_acesso.ilike.%${q}%`,
      `razao_social_emitente.ilike.%${q}%`,
      `razao_social_destinatario.ilike.%${q}%`,
    ]
    if (digitos) {
      condicoes.push(`cnpj_emitente.ilike.%${digitos}%`)
      condicoes.push(`cnpj_destinatario.ilike.%${digitos}%`)
    }
    query = query.or(condicoes.join(','))
  }
  return query
}

export async function carregarNotasFiscaisGestorPaginadas(
  filtros: FiltrosNotasFiscaisGestor,
): Promise<ResultadoNotasFiscaisGestor> {
  const auth = await requireGestor()
  const contexto = await resolverContextoFundoGestor(auth)

  const { data: vinculosData, error: vinculosError } = await auth.supabase
    .from('cedente_fundos')
    .select('id, cedente_id, cedentes(id, razao_social)')
    .eq('fundo_id', contexto.fundoId)
    .eq('status', 'ativo')

  if (vinculosError) {
    throw new Error(`Nao foi possivel carregar os vinculos do fundo: ${vinculosError.message}`)
  }

  const vinculos = (vinculosData || []) as unknown as Array<{
    id: string
    cedente_id: string
    cedentes: { id: string; razao_social: string } | null
  }>
  const cedenteFundoIds = vinculos.map((item) => item.id)
  const cedentes = Array.from(new Map(
    vinculos
      .filter((item) => item.cedentes)
      .map((item) => [item.cedente_id, {
        id: item.cedente_id,
        nome: item.cedentes?.razao_social || item.cedente_id,
      }]),
  ).values()).sort((a, b) => a.nome.localeCompare(b.nome))

  if (cedenteFundoIds.length === 0) {
    return {
      ...buildPaginatedResult([], {
        page: filtros.page,
        pageSize: filtros.pageSize,
        total: 0,
      }),
      metricasPagina: { pendentes: 0, aprovadas: 0, valor: 0 },
      cedentes,
    }
  }

  let range = buildOffsetRange(filtros)
  let result = await aplicarFiltros(auth.supabase, filtros, cedenteFundoIds)
    .order(filtros.sort, { ascending: filtros.direction === 'asc' })
    .order('id', { ascending: filtros.direction === 'asc' })
    .range(range.from, range.to)

  if (result.error) {
    throw new Error(`Nao foi possivel carregar as notas fiscais: ${result.error.message}`)
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
    result = await aplicarFiltros(auth.supabase, {
      ...filtros,
      page: meta.page,
    }, cedenteFundoIds)
      .order(filtros.sort, { ascending: filtros.direction === 'asc' })
      .order('id', { ascending: filtros.direction === 'asc' })
      .range(range.from, range.to)
    if (result.error) {
      throw new Error(`Nao foi possivel ajustar a pagina das notas fiscais: ${result.error.message}`)
    }
  }

  const rows = (result.data || []) as unknown as NotaRow[]
  const ids = rows.map((item) => item.id)
  const [documentos, operacoesLinksResult] = await Promise.all([
    carregarResumoDocumentalDasNotas(auth.supabase, ids),
    ids.length
      ? auth.supabase
        .from('operacoes_nfs')
        .select('nota_fiscal_id, operacao_id')
        .in('nota_fiscal_id', ids)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (operacoesLinksResult.error) {
    throw new Error(`Nao foi possivel carregar os vinculos operacionais: ${operacoesLinksResult.error.message}`)
  }

  const links = operacoesLinksResult.data || []
  const operacaoIds = Array.from(new Set(links.map((item) => item.operacao_id)))
  const { data: operacoesData, error: operacoesError } = operacaoIds.length
    ? await auth.supabase
      .from('operacoes')
      .select('id')
      .in('id', operacaoIds)
    : { data: [], error: null }
  if (operacoesError) {
    throw new Error(`Nao foi possivel carregar as operacoes das notas: ${operacoesError.message}`)
  }

  const operacaoPorId = new Set((operacoesData || []).map((item) => item.id))
  const operacaoPorNota = new Map<string, { id: string; codigo: string }>()
  for (const link of links) {
    if (operacaoPorId.has(link.operacao_id) && !operacaoPorNota.has(link.nota_fiscal_id)) {
      operacaoPorNota.set(link.nota_fiscal_id, {
        id: link.operacao_id,
        codigo: link.operacao_id.slice(0, 8),
      })
    }
  }

  const items = rows.map((row): NotaFiscalGestorListagemItem => {
    const avaliacao = documentos.avaliacoes.get(row.id)
    return {
      id: row.id,
      numero: row.numero_nf,
      serie: row.serie,
      chaveAcesso: row.chave_acesso,
      status: row.status,
      cedente: {
        id: row.cedente_id,
        nome: row.razao_social_emitente,
        cnpj: row.cnpj_emitente,
      },
      sacado: {
        nome: row.razao_social_destinatario,
        cnpj: row.cnpj_destinatario,
      },
      valorBruto: Number(row.valor_bruto || 0),
      emissaoEm: row.data_emissao,
      vencimentoEm: row.data_vencimento,
      operacao: operacaoPorNota.get(row.id) || null,
      resumoDocumental: {
        totalObrigatorios: avaliacao?.totalObrigatorios || 0,
        totalSatisfeitos: avaliacao?.concluidosObrigatorios || 0,
        totalPendentes: avaliacao?.pendentesObrigatorios || 0,
        possuiRejeicao: avaliacao?.possuiRejeicao || false,
        elegivel: avaliacao?.elegivel || false,
      },
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }
  })

  return {
    ...buildPaginatedResult(items, {
      page: meta.page,
      pageSize: filtros.pageSize,
      total,
    }),
    metricasPagina: calcularMetricasPaginaNotasGestor(items),
    cedentes,
  }
}
