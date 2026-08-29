import { describe, expect, it } from 'vitest'
import { calcularPrazoDocumento } from './prazos'

describe('calcularPrazoDocumento', () => {
  it('retorna dentro do prazo com dias restantes', () => {
    const prazo = calcularPrazoDocumento({
      status: 'pendente',
      dataInicioPrazo: '2026-07-23T12:00:00Z',
      prazoLimite: '2026-08-02',
      hoje: '2026-07-23',
    })

    expect(prazo.statusPrazo).toBe('dentro_do_prazo')
    expect(prazo.prazoDias).toBe(10)
    expect(prazo.prazoDetalhe).toBe('Restam 10 dia(s)')
    expect(prazo.marcoPrazo).toBe('desembolso')
  })

  it('retorna vence hoje', () => {
    const prazo = calcularPrazoDocumento({
      status: 'pendente',
      dataInicioPrazo: '2026-07-20',
      prazoLimite: '2026-07-23',
      hoje: '2026-07-23',
    })

    expect(prazo.statusPrazo).toBe('vence_hoje')
    expect(prazo.prazoDetalhe).toBe('Vence hoje')
  })

  it('retorna vencido com atraso', () => {
    const prazo = calcularPrazoDocumento({
      status: 'pendente',
      dataInicioPrazo: '2026-07-10',
      prazoLimite: '2026-07-20',
      hoje: '2026-07-23',
    })

    expect(prazo.statusPrazo).toBe('vencido')
    expect(prazo.prazoDetalhe).toBe('Em atraso ha 3 dia(s)')
  })

  it('retorna concluido quando requisito esta satisfeito', () => {
    const prazo = calcularPrazoDocumento({
      status: 'satisfeito',
      dataInicioPrazo: '2026-07-10',
      prazoLimite: '2026-07-20',
      hoje: '2026-07-23',
    })

    expect(prazo.statusPrazo).toBe('concluido')
    expect(prazo.prazoTexto).toBe('Concluido')
  })
})
