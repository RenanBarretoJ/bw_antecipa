import { describe, expect, it } from 'vitest'
import {
  classificarEstadoExecucaoFinanceira,
  rotuloEstadoExecucaoFinanceira,
  totalDeContagens,
} from './execution-state'

describe('estado operacional das execucoes financeiras', () => {
  it('distingue ausencia total de uma execucao historica nao aplicavel', () => {
    expect(classificarEstadoExecucaoFinanceira({ atual: null, anterior: null })).toBe('SEM_EXECUCAO')
    expect(classificarEstadoExecucaoFinanceira({ atual: null, anterior: { status: 'CONCLUIDA' } })).toBe('HISTORICA_NAO_APLICAVEL')
  })

  it('trata execucao concluida com zero registros como sem movimento, nao como ausente', () => {
    const estado = classificarEstadoExecucaoFinanceira({
      atual: { status: 'CONCLUIDA' },
      totalRegistros: 0,
    })
    expect(estado).toBe('EXECUTADA_SEM_MOVIMENTO')
    expect(rotuloEstadoExecucaoFinanceira(estado)).toBe('Executado — sem movimento')
  })

  it('usa cópia operacional distinta para ausência, histórico e processamento', () => {
    expect(rotuloEstadoExecucaoFinanceira('SEM_EXECUCAO')).toBe('Não executado')
    expect(rotuloEstadoExecucaoFinanceira('HISTORICA_NAO_APLICAVEL')).toBe('Histórico — não aplicável à data selecionada')
    expect(rotuloEstadoExecucaoFinanceira('PROCESSANDO')).toBe('Em processamento')
  })

  it.each([
    ['BASE_INCOMPLETA', 'BASE_INCOMPLETA'],
    ['FALHA', 'ERRO'],
    ['PROCESSANDO', 'PROCESSANDO'],
    ['CONCLUIDA', 'EXECUTADA'],
  ] as const)('mapeia status persistido %s para %s', (status, esperado) => {
    expect(classificarEstadoExecucaoFinanceira({ atual: { status }, totalRegistros: 1 })).toBe(esperado)
  })

  it('soma contagens sem converter ausencia em zero implicitamente', () => {
    expect(totalDeContagens({ MANTIDO_CORRETO: 2, DIVERGENCIA_VALOR: 1 })).toBe(3)
    expect(totalDeContagens({})).toBe(0)
  })
})
