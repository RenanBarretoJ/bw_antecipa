import { describe, expect, it } from 'vitest'
import { ajustarDataEnvio } from './calendario'
import { colapsarEtapasNaMesmaData, listarEtapasAte, resolverEtapaAcionavel } from './regua'
import { REGUA_FINANCEIRA_PADRAO, REGUA_LOGISTICA_PADRAO } from './tipos'

describe('regua de comunicacoes', () => {
  it('preserva os defaults logisticos e financeiros solicitados', () => {
    expect(REGUA_LOGISTICA_PADRAO).toEqual({ offsets: [-5, -3, -1, 0, 1, 3], recorrenciaApos: 3, recorrenciaDias: 3 })
    expect(REGUA_FINANCEIRA_PADRAO).toEqual({ offsets: [-7, -3, -1, 0, 1, 3, 5, 7], recorrenciaApos: 7, recorrenciaDias: 3 })
  })

  it('move lembrete negativo para o dia util anterior', () => {
    expect(ajustarDataEnvio('2026-08-09', -1)).toEqual({ dataEfetiva: '2026-08-07', motivoAjuste: 'antecipada_para_dia_util_anterior' })
  })

  it('move D0 e atraso para o proximo dia util', () => {
    expect(ajustarDataEnvio('2026-09-07', 0)).toEqual({ dataEfetiva: '2026-09-08', motivoAjuste: 'postergada_para_proximo_dia_util' })
  })

  it('colapsa colisoes mantendo a etapa mais critica', () => {
    const stages = listarEtapasAte('2026-08-10', '2026-08-10', REGUA_LOGISTICA_PADRAO)
    const collapsed = colapsarEtapasNaMesmaData(stages)
    const friday = collapsed.find((item) => item.dataEfetiva === '2026-08-07')
    expect(friday?.offset).toBe(-1)
  })

  it('gera recorrencia a cada tres dias apos o ultimo marco fixo', () => {
    const stages = listarEtapasAte('2026-08-10', '2026-08-24', REGUA_FINANCEIRA_PADRAO)
    expect(stages.filter((item) => item.recorrente).map((item) => item.offset)).toEqual([10, 13, 16, 19])
  })

  it('faz catch-up controlado sem disparar toda a sequencia historica', () => {
    const stage = resolverEtapaAcionavel({ dataObrigacao: '2026-08-01', dataExecucao: '2026-08-10', ativadaEm: '2026-08-10', regua: REGUA_LOGISTICA_PADRAO })
    expect(stage).not.toBeNull()
    expect(stage?.offset).toBeGreaterThan(0)
  })

  it('nao repete uma etapa ja comunicada', () => {
    const first = resolverEtapaAcionavel({ dataObrigacao: '2026-08-10', dataExecucao: '2026-08-10', ativadaEm: '2026-08-01', regua: REGUA_LOGISTICA_PADRAO })
    expect(first?.chave).toBe('D+0')
    const repeated = resolverEtapaAcionavel({ dataObrigacao: '2026-08-10', dataExecucao: '2026-08-10', ativadaEm: '2026-08-01', regua: REGUA_LOGISTICA_PADRAO, etapasComunicadas: new Set(['D+0']) })
    expect(repeated).toBeNull()
  })
})
