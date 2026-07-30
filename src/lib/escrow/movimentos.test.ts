import { describe, expect, it } from 'vitest'
import { encodeCursor } from '@/lib/pagination'
import { normalizarFiltrosMovimentos, paginarMovimentos, validarCursorMovimentos } from './movimentos'

describe('cursor e filtros do extrato escrow', () => {
  it('preserva desempate por created_at e id no cursor', () => {
    const cursor = encodeCursor({
      createdAt: '2026-07-30T10:20:30.123456Z',
      id: '00000000-0000-4000-8000-000000000002',
    })
    expect(validarCursorMovimentos(cursor)).toEqual({
      createdAt: '2026-07-30T10:20:30.123456Z',
      id: '00000000-0000-4000-8000-000000000002',
    })
  })

  it('descarta cursor, datas e tipos invalidos', () => {
    expect(validarCursorMovimentos('cursor-invalido')).toBeNull()
    expect(normalizarFiltrosMovimentos({
      tipo: 'saida' as never,
      dataInicio: '30/07/2026',
      dataFim: '2026-07-30',
    })).toEqual({ tipo: null, dataInicio: '', dataFim: '2026-07-30' })
  })

  it('busca 21, devolve 20 e usa o ultimo item visivel no proximo cursor', () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      tipo: 'credito',
      descricao: `Movimento ${index + 1}`,
      valor: 10,
      saldo_apos: 100,
      created_at: '2026-07-30T10:20:30.123456Z',
    }))
    const resultado = paginarMovimentos(rows)
    expect(resultado.items).toHaveLength(20)
    expect(resultado.hasMore).toBe(true)
    expect(validarCursorMovimentos(resultado.nextCursor)).toEqual({
      createdAt: rows[19].created_at,
      id: rows[19].id,
    })
  })
})
