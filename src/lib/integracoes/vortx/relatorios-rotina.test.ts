import { describe, expect, it } from 'vitest'
import { planejarRotinaRelatoriosVortx } from './relatorios-rotina'

describe('rotina Vórtx D−1 útil ANBIMA', () => {
  it.each([
    ['2026-10-20T12:30:00Z','2026-10-19'],
    ['2026-10-19T12:30:00Z','2026-10-16'],
    ['2026-10-13T12:30:00Z','2026-10-09'],
    ['2026-01-02T12:30:00Z','2025-12-31'],
  ])('usa data anterior correta em %s', (instant, reference) => {
    const plan = planejarRotinaRelatoriosVortx(new Date(instant))
    expect(plan.executar).toBe(true)
    expect(plan.pedidos).toHaveLength(4)
    expect(new Set(plan.pedidos.map(p => p.tipo))).toEqual(new Set(['PosicaoAtivo','PosicaoParcela','Inclusao','Exclusao']))
    expect(plan.pedidos.every(p => p.referencia === reference && p.fim === reference && p.extensao === 2)).toBe(true)
    expect(plan.pedidos.every(p => p.inicio < p.fim)).toBe(true)
  })
  it.each(['2026-10-17','2026-10-18','2026-10-12','2026-12-25','2026-01-01'])('não dispara em %s', date => {
    expect(planejarRotinaRelatoriosVortx(new Date(`${date}T12:30:00Z`))).toMatchObject({ executar:false,pedidos:[],motivo:'DIA_NAO_UTIL_ANBIMA' })
  })
  it('deriva a data civil de Brasília, não de UTC nem de payload humano', () => {
    expect(planejarRotinaRelatoriosVortx(new Date('2026-10-20T01:00:00Z'))).toMatchObject({dataOperacional:'2026-10-19'})
  })
})
