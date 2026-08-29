import { describe, expect, it } from 'vitest'
import { avaliarCompletudeBases, reconciliarTitulosD2D1 } from './reconciliation'
import { RECONCILIATION_STATUSES, type ReconciliationRow, type ReconciliationStatus } from './types'

const FUND = '11111111-1111-4111-8111-111111111111'
const ID = '900719925474099312345'

function row(overrides: Partial<ReconciliationRow> = {}): ReconciliationRow {
  return {
    identidadeExterna: ID,
    fundoId: FUND,
    provedor: 'rlx_golden',
    valorAquisicao: '100.00',
    ...overrides,
  }
}

function status(input: {
  d2?: ReconciliationRow[]
  d1?: ReconciliationRow[]
  acq?: ReconciliationRow[]
  liq?: ReconciliationRow[]
  contexto?: Parameters<typeof reconciliarTitulosD2D1>[0]['contexto']
}): ReconciliationStatus {
  return reconciliarTitulosD2D1({
    fundoId: FUND,
    estoqueD2: input.d2 || [],
    estoqueD1: input.d1 || [],
    aquisicoesD1: input.acq || [],
    liquidacoesD1: input.liq || [],
    contexto: input.contexto,
  })[0].status
}

describe('conciliacao RLX_RECON_V1', () => {
  const classificationCases: Array<[ReconciliationStatus, Parameters<typeof status>[0]]> = [
    ['MANTIDO_CORRETO', { d2: [row()], d1: [row()] }],
    ['ENTRADA_INCORPORADA', { d1: [row()], acq: [row({ valorMovimento: '95.00' })] }],
    ['ENTRADA_NAO_INCORPORADA', { acq: [row({ valorMovimento: '95.00' })] }],
    ['ENTRADA_SEM_AQUISICAO', { d1: [row()] }],
    ['SAIDA_REFLETIDA', { d2: [row()], liq: [row({ valorMovimento: '100.00', tipoMovimento: 'MOV_FULL' })] }],
    ['SAIDA_SEM_LIQUIDACAO', { d2: [row()] }],
    ['LIQUIDADO_AINDA_NO_ESTOQUE', { d2: [row()], d1: [row()], liq: [row({ valorMovimento: '100.00', tipoMovimento: 'MOV_FULL' })] }],
    ['DIVERGENCIA_VALOR', { d2: [row()], d1: [row({ valorAquisicao: '100.01' })] }],
  ]

  it.each(classificationCases)('classifica %s por evidencia financeira', (expected, input) => {
    expect(status(input)).toBe(expected)
  })

  it('preserva liquidacoes repetidas e parcialidade sem calcular saldo definitivo', () => {
    const repeated = reconciliarTitulosD2D1({
      fundoId: FUND,
      estoqueD2: [row()],
      estoqueD1: [row()],
      aquisicoesD1: [],
      liquidacoesD1: [
        row({ valorMovimento: '40.00', tipoMovimento: 'MOV_PARTIAL' }),
        row({ valorMovimento: '25.00', tipoMovimento: 'MOV_PARTIAL' }),
      ],
    })[0]
    expect(repeated.status).toBe('LIQUIDACAO_REPETIDA_MESMO_DIA')
    expect(repeated.liquidacoesCount).toBe(2)
    expect(repeated.liquidacoesValorPago).toBe('65.00')
    expect(repeated.detalhes.semCalculoDeSaldo).toBe(true)

    expect(status({
      d2: [row()], d1: [row()], liq: [row({ valorMovimento: '40.00', statusRecebivel: 'PARCIAL_QA' })],
    })).toBe('LIQUIDACAO_PARCIAL_SALDO')
  })

  it('representa alertas documentados somente quando existe evidencia explicita', () => {
    const cases: Array<[ReconciliationStatus, Parameters<typeof status>[0]['contexto']]> = [
      ['RETIFICACAO_ESTOQUE', { estoqueRetificadoIdentidades: new Set([ID]) }],
      ['RETIFICACAO_AQUISICAO', { aquisicaoRetificadaIdentidades: new Set([ID]) }],
      ['NAO_CONCILIADO', { identidadesSemConciliacao: new Set([ID]) }],
      ['DIA_SEM_MOVIMENTO', { diaSemMovimentoIdentidades: new Set([ID]) }],
      ['ARQUIVO_DUPLICADO_HASH', { arquivoDuplicadoIdentidades: new Set([ID]) }],
      ['SAIDA_NAO_REFLETIDA', { liquidacaoExigeSaidaIdentidades: new Set([ID]) }],
    ]
    for (const [expected, contexto] of cases) {
      const input = expected === 'SAIDA_NAO_REFLETIDA'
        ? { d2: [row()], d1: [row()], liq: [row({ valorMovimento: '100.00' })], contexto }
        : { d2: [row()], d1: [row()], contexto }
      expect(status(input)).toBe(expected)
    }
  })

  it('bloqueia conciliacao normal quando uma base esta ausente ou incompleta', () => {
    expect(avaliarCompletudeBases([
      { nome: 'ESTOQUE_D2', existe: true, completude: 'COMPLETO_COM_DADOS' },
      { nome: 'ESTOQUE_D1', existe: true, completude: 'COMPLETO_COM_DADOS' },
      { nome: 'AQUISICOES_D1', existe: true, completude: 'COMPLETO_VAZIO' },
      { nome: 'LIQUIDACOES_D1', existe: false, completude: null },
    ])).toEqual(['LIQUIDACOES_D1'])
    expect(RECONCILIATION_STATUSES).toContain('BASE_INCOMPLETA')
  })
})
