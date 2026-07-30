import 'server-only'

import { requireGestor } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { buildOffsetRange, buildPaginatedResult, buildPaginationMeta } from '@/lib/pagination'
import type { CedenteGestorItem, FiltrosCedentesGestor, ResultadoCedentesGestor } from './gestor-listagem'

const SELECT = `
  id,
  cedente_id,
  created_at,
  cedentes!inner(id, cnpj, razao_social, status, created_at),
  cedente_fundo_politicas(id, politica_operacional_id, status, politicas_operacionais(id, nome))
` as const
const SELECT_COM_POLITICA = SELECT.replace(
  'cedente_fundo_politicas(',
  'cedente_fundo_politicas!inner(',
)

function aplicarFiltros(
  supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'],
  fundoId: string,
  filtros: FiltrosCedentesGestor,
) {
  let query = supabase
    .from('cedente_fundos')
    .select(filtros.politicaId ? SELECT_COM_POLITICA : SELECT, { count: 'exact' })
    .eq('fundo_id', fundoId)
    .in('status', ['ativo', 'suspenso'])

  if (filtros.status) query = query.eq('cedentes.status', filtros.status)
  if (filtros.politicaId) {
    query = query
      .eq('cedente_fundo_politicas.politica_operacional_id', filtros.politicaId)
      .eq('cedente_fundo_politicas.status', 'ativa')
  }
  if (filtros.q) {
    const seguro = filtros.q.replace(/[,%().'"\u005c]/g, ' ')
    const digitos = filtros.q.replace(/\D/g, '')
    const condicoes = [`razao_social.ilike.%${seguro}%`]
    if (digitos) condicoes.push(`cnpj.ilike.%${digitos}%`)
    query = query.or(condicoes.join(','), { referencedTable: 'cedentes' })
  }
  return query
}

type Row = {
  id: string
  cedentes: { id: string; cnpj: string; razao_social: string; status: string; created_at: string } | null
  cedente_fundo_politicas: Array<{
    politica_operacional_id: string
    status: string
    politicas_operacionais: { id: string; nome: string } | null
  }>
}

export async function carregarCedentesGestorPaginados(
  filtros: FiltrosCedentesGestor,
): Promise<ResultadoCedentesGestor> {
  const auth = await requireGestor()
  const contexto = await resolverContextoFundoGestor(auth)
  const ascending = filtros.direction === 'asc'
  const nestedSort = filtros.sort === 'razao_social' || filtros.sort === 'status'

  const executar = async (page: number) => {
    const range = buildOffsetRange({ page, pageSize: filtros.pageSize })
    let query = aplicarFiltros(auth.supabase, contexto.fundoId, filtros)
    query = nestedSort
      ? query.order(filtros.sort, { ascending, referencedTable: 'cedentes' }).order('id', { ascending })
      : query.order('created_at', { ascending }).order('id', { ascending })
    return query.range(range.from, range.to)
  }

  let result = await executar(filtros.page)
  if (result.error) throw new Error(`Nao foi possivel carregar os cedentes: ${result.error.message}`)
  const total = result.count || 0
  const meta = buildPaginationMeta({
    page: filtros.page,
    pageSize: filtros.pageSize,
    total,
    currentItemCount: result.data?.length || 0,
  })
  if (meta.wasPageAdjusted && total > 0) {
    result = await executar(meta.page)
    if (result.error) throw new Error(`Nao foi possivel ajustar a pagina de cedentes: ${result.error.message}`)
  }

  const items = ((result.data || []) as unknown as Row[]).flatMap((row): CedenteGestorItem[] => {
    if (!row.cedentes) return []
    const atribuicao = row.cedente_fundo_politicas?.find((item) => item.status === 'ativa')
    return [{
      id: row.cedentes.id,
      cedenteFundoId: row.id,
      cnpj: row.cedentes.cnpj,
      razaoSocial: row.cedentes.razao_social,
      status: row.cedentes.status,
      criadoEm: row.cedentes.created_at,
      politica: atribuicao?.politicas_operacionais
        ? { id: atribuicao.politicas_operacionais.id, nome: atribuicao.politicas_operacionais.nome }
        : null,
    }]
  })
  return buildPaginatedResult(items, { page: meta.page, pageSize: filtros.pageSize, total })
}
