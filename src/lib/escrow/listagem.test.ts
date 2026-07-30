import { describe, expect, it } from 'vitest'
import { calcularMetricasPaginaEscrow, parseFiltrosEscrow } from './listagem'

describe('listagem paginada de escrow', () => {
  it('rejeita status, cedente e ordenacao fora das allowlists', () => {
    const filtros = parseFiltrosEscrow({
      status: 'qualquer',
      cedente: 'nao-uuid',
      sort: 'saldo_total',
      page: '0',
      pageSize: '11',
    })
    expect(filtros).toMatchObject({
      status: null,
      cedenteId: null,
      sort: 'created_at',
      page: 1,
      pageSize: 10,
    })
  })

  it('calcula apenas metricas dos itens da pagina', () => {
    const metricas = calcularMetricasPaginaEscrow([
      {
        id: crypto.randomUUID(),
        cedenteId: crypto.randomUUID(),
        identificador: 'A',
        saldoDisponivel: 100,
        saldoBloqueado: 20,
        status: 'ativa',
        criadoEm: '2026-07-30T10:00:00Z',
        cedente: { nome: 'Cedente A', cnpj: '00000000000000' },
      },
      {
        id: crypto.randomUUID(),
        cedenteId: crypto.randomUUID(),
        identificador: 'B',
        saldoDisponivel: 50,
        saldoBloqueado: 5,
        status: 'bloqueada',
        criadoEm: '2026-07-30T09:00:00Z',
        cedente: { nome: 'Cedente B', cnpj: '00000000000000' },
      },
    ])
    expect(metricas).toEqual({ ativas: 1, saldoDisponivel: 150, saldoBloqueado: 25 })
  })
})
