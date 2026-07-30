'use server'

import { requireNotaFiscalAccess, requireOperationAccess } from '@/lib/auth/authorization'
import { obterFundoAtivoAutorizado } from '@/lib/actions/fundo-ativo'
import { resumirMetadataHistorico, type HistoricoCategoria, type HistoricoEventoView } from '@/lib/eventos-dominio/formatters'
import { encodeCursor, parseCursor } from '@/lib/pagination/cursor'
import { buildDescendingCreatedAtCursorFilter } from '@/lib/pagination/keyset'
import type { CursorResult } from '@/lib/pagination/types'

type EntidadeHistorico = 'nota_fiscal' | 'operacao'
type FiltroHistorico = 'todos' | 'documento' | 'aprovacao' | 'operacao' | 'logistica'

export type HistoricoCursor = string

export type HistoricoPaginaResult = {
  success: boolean
  message?: string
  data?: CursorResult<HistoricoEventoView> & { total?: number }
}

function filtroCategorias(filtro: FiltroHistorico): HistoricoCategoria[] | null {
  if (filtro === 'todos') return null
  if (filtro === 'aprovacao') return ['analise', 'aprovacao', 'reprovacao']
  if (filtro === 'operacao') return ['operacao', 'desembolso', 'conclusao']
  return [filtro]
}

function mapEvento(row: Record<string, unknown>): HistoricoEventoView {
  return {
    id: String(row.id),
    tipoEvento: String(row.tipo_evento),
    categoria: String(row.categoria) as HistoricoCategoria,
    descricao: String(row.descricao ?? ''),
    atorNome: String(row.ator_nome_snapshot ?? 'Sistema'),
    atorPerfil: String(row.ator_perfil_snapshot ?? 'Sistema'),
    origem: String(row.origem ?? 'app'),
    metadataResumo: resumirMetadataHistorico(row.metadata),
    visibilidade: String(row.visibilidade ?? 'ambos') as HistoricoEventoView['visibilidade'],
    createdAt: String(row.created_at),
  }
}

async function prepararConsulta(entidade: EntidadeHistorico, entidadeId: string) {
  const context = entidade === 'nota_fiscal'
    ? await requireNotaFiscalAccess(entidadeId)
    : await requireOperationAccess(entidadeId)

  const field = entidade === 'nota_fiscal' ? 'nota_fiscal_id' : 'operacao_id'
  const fundoAtivo = context.profile.role === 'gestor' ? await obterFundoAtivoAutorizado() : null
  return { supabase: context.supabase, field, fundoAtivo }
}

export async function carregarEventosHistorico(input: {
  entidade: EntidadeHistorico
  entidadeId: string
  filtro?: FiltroHistorico
  cursor?: HistoricoCursor | null
  limit?: number
  incluirTotal?: boolean
}): Promise<HistoricoPaginaResult> {
  try {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
    const { supabase, field, fundoAtivo } = await prepararConsulta(input.entidade, input.entidadeId)
    const categorias = filtroCategorias(input.filtro ?? 'todos')

    let query = supabase
      .from('eventos_dominio')
      .select(
        'id, tipo_evento, categoria, ator_nome_snapshot, ator_perfil_snapshot, origem, descricao, metadata, visibilidade, created_at',
        { count: input.incluirTotal ? 'exact' : undefined },
      )
      .eq(field, input.entidadeId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1)

    if (categorias) query = query.in('categoria', categorias)
    const cursor = input.cursor ? parseCursor(input.cursor) : null
    if (input.cursor && !cursor) return { success: false, message: 'Cursor de historico invalido.' }
    if (cursor) query = query.or(buildDescendingCreatedAtCursorFilter(cursor))
    if (fundoAtivo?.fundoId) query = query.eq('fundo_id', fundoAtivo.fundoId)

    const { data, error, count } = await query
    if (error) return { success: false, message: error.message }

    const rows = (data ?? []) as Array<Record<string, unknown>>
    const pageRows = rows.slice(0, limit)
    const last = pageRows[pageRows.length - 1]
    return {
      success: true,
      data: {
        items: pageRows.map(mapEvento),
        hasMore: rows.length > limit,
        nextCursor: rows.length > limit && last
          ? encodeCursor({ createdAt: String(last.created_at), id: String(last.id) })
          : null,
        ...(input.incluirTotal ? { total: count ?? 0 } : {}),
      },
    }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Nao foi possivel carregar o historico.' }
  }
}
