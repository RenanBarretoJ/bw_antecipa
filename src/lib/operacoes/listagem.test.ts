import { describe, expect, it } from 'vitest'
import { calcularMetricasPaginaOperacoes, parseFiltrosOperacoes, type OperacaoListagemItem } from './listagem'

function operacao(overrides: Partial<OperacaoListagemItem> = {}): OperacaoListagemItem {
  return {
    id: crypto.randomUUID(),
    cedenteId: crypto.randomUUID(),
    cedenteFundoId: crypto.randomUUID(),
    cedenteNome: 'Cedente',
    cedenteCnpj: '00111222000133',
    valorBruto: 1000,
    taxaDesconto: 2,
    prazoDias: 30,
    valorLiquido: 950,
    vencimento: '2026-08-30',
    status: 'solicitada',
    criadoEm: '2026-07-29T10:00:00Z',
    aprovadoEm: null,
    aceiteSacadoExigido: true,
    aceiteSacadoStatus: 'pendente',
    ...overrides,
  }
}

describe('listagem de operacoes', () => {
  it('normaliza pagina, limite, status e ordenacao por allowlist', () => {
    const filtros = parseFiltrosOperacoes({
      page: '-4',
      pageSize: '999',
      status: 'DROP TABLE',
      sort: 'senha',
      direction: 'invalid',
      q: '  Cedente   Exemplo  ',
    })
    expect(filtros.pagina).toBe(1)
    expect(filtros.limite).toBe(10)
    expect(filtros.status).toBeNull()
    expect(filtros.ordenacao).toBe('created_at')
    expect(filtros.direcao).toBe('desc')
    expect(filtros.busca).toBe('Cedente Exemplo')
  })

  it('calcula somente metricas da pagina recebida', () => {
    const metricas = calcularMetricasPaginaOperacoes([
      operacao(),
      operacao({ aceiteSacadoExigido: false, aceiteSacadoStatus: 'dispensado' }),
      operacao({ status: 'em_andamento', valorLiquido: 1250 }),
    ])
    expect(metricas.aguardandoAceite).toBe(1)
    expect(metricas.prontasAnalise).toBe(1)
    expect(metricas.emAndamento).toBe(1)
    expect(metricas.volumeAtivo).toBe(1250)
  })
})
