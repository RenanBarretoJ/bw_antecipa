import { encodeCursor, normalizeSearch, parseCursor, type CursorResult } from '@/lib/pagination'

export const MOVIMENTOS_PAGE_SIZE = 20
export type PerfilExtrato = 'gestor' | 'consultor' | 'cedente'
export type MovimentoTipo = 'credito' | 'debito'

export interface FiltrosMovimentos {
  tipo: MovimentoTipo | null
  dataInicio: string
  dataFim: string
}

export interface MovimentoEscrowItem {
  id: string
  tipo: MovimentoTipo
  descricao: string
  valor: number
  saldoApos: number
  criadoEm: string
}

export interface ContaEscrowDetalhe {
  id: string
  cedenteId: string
  identificador: string
  saldoDisponivel: number
  saldoBloqueado: number
  status: string
  cedente: { nome: string; cnpj: string }
}

export type ResultadoMovimentos = CursorResult<MovimentoEscrowItem>

export interface MovimentoEscrowRow {
  id: string
  tipo: string
  descricao: string
  valor: number
  saldo_apos: number
  created_at: string
}

export function normalizarFiltrosMovimentos(input: Partial<FiltrosMovimentos>): FiltrosMovimentos {
  const dataPattern = /^\d{4}-\d{2}-\d{2}$/
  return {
    tipo: input.tipo === 'credito' || input.tipo === 'debito' ? input.tipo : null,
    dataInicio: dataPattern.test(input.dataInicio || '') ? input.dataInicio! : '',
    dataFim: dataPattern.test(input.dataFim || '') ? input.dataFim! : '',
  }
}

export function validarCursorMovimentos(cursor: unknown) {
  return cursor ? parseCursor(normalizeSearch(cursor, 500)) : null
}

export function paginarMovimentos(rows: MovimentoEscrowRow[]): ResultadoMovimentos {
  const items = rows.slice(0, MOVIMENTOS_PAGE_SIZE).map((row): MovimentoEscrowItem => ({
    id: row.id,
    tipo: row.tipo as MovimentoTipo,
    descricao: row.descricao,
    valor: Number(row.valor || 0),
    saldoApos: Number(row.saldo_apos || 0),
    criadoEm: row.created_at,
  }))
  const hasMore = rows.length > MOVIMENTOS_PAGE_SIZE
  const last = items.at(-1)
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.criadoEm, id: last.id }) : null,
  }
}
