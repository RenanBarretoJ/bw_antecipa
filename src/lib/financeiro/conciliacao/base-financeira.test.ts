import { describe, expect, it } from 'vitest'
import { execucaoExposicaoCompativelComBase, montarBaseFinanceiraDaData, type ImportacaoResumoBase } from './base-financeira'

const importacao = (overrides: Partial<ImportacaoResumoBase>): ImportacaoResumoBase => ({
  id: '737c449c-a723-4b33-8f47-4089c88dc1f8',
  tipo_base: 'CARTEIRA',
  data_referencia: '2026-08-20',
  completude: 'COMPLETO_COM_DADOS',
  declaracao_sem_movimento: false,
  origem: 'GOLDEN_DATASET',
  provedor: 'qa_synthetic_pl',
  linhas_publicadas: 1,
  valor_total: '1000000',
  publicada_em: '2026-08-24T19:47:18.972Z',
  ...overrides,
})

describe('base financeira D-1/D-2 da conciliacao', () => {
  it('resolve 24/08 com D-1 21/08 e PL QA D-2 20/08 sem transformar bases ausentes em zero', () => {
    const result = montarBaseFinanceiraDaData({
      dataOperacional: '2026-08-24',
      importacoes: [importacao({})],
      snapshots: [{ importacao_id: '737c449c-a723-4b33-8f47-4089c88dc1f8', patrimonio_liquido: '1000000', vigente: true }],
    })
    expect(result).toMatchObject({ dataD1: '2026-08-21', dataD2: '2026-08-20', statusGeral: 'BASE_INCOMPLETA' })
    expect(result.carteira).toMatchObject({ estado: 'VALOR', valor: '1000000.0000', origemQa: true })
    expect(result.estoque).toMatchObject({ estado: 'INDISPONIVEL', valor: null })
    expect(result.aquisicoes.valor).toBeNull()
    expect(result.liquidacoes.valor).toBeNull()
  })

  it('nao reutiliza o PL de 20/08 para a data operacional 27/08, que exige D-2 25/08', () => {
    const result = montarBaseFinanceiraDaData({
      dataOperacional: '2026-08-27',
      importacoes: [importacao({})],
      snapshots: [{ importacao_id: '737c449c-a723-4b33-8f47-4089c88dc1f8', patrimonio_liquido: '1000000', vigente: true }],
    })
    expect(result.dataD2).toBe('2026-08-25')
    expect(result.carteira).toMatchObject({ estado: 'INDISPONIVEL', valor: null, importacaoId: null })
    expect(result.statusGeral).toBe('INDISPONIVEL')
  })

  it('distingue sem movimento declarado de valor monetario realmente zero', () => {
    const result = montarBaseFinanceiraDaData({
      dataOperacional: '2026-08-24',
      importacoes: [
        importacao({}),
        importacao({ id: '11111111-1111-4111-8111-111111111111', tipo_base: 'ESTOQUE', data_referencia: '2026-08-21', origem: 'MANUAL', provedor: 'administradora', valor_total: '0' }),
        importacao({ id: '22222222-2222-4222-8222-222222222222', tipo_base: 'AQUISICOES', data_referencia: '2026-08-21', completude: 'COMPLETO_VAZIO', declaracao_sem_movimento: true }),
        importacao({ id: '33333333-3333-4333-8333-333333333333', tipo_base: 'LIQUIDACOES', data_referencia: '2026-08-21', completude: 'COMPLETO_VAZIO', declaracao_sem_movimento: true }),
      ],
      snapshots: [{ importacao_id: '737c449c-a723-4b33-8f47-4089c88dc1f8', patrimonio_liquido: '1000000', vigente: true }],
    })
    expect(result.estoque.estado).toBe('ZERO')
    expect(result.aquisicoes.estado).toBe('SEM_MOVIMENTO')
    expect(result.liquidacoes.estado).toBe('SEM_MOVIMENTO')
    expect(result.statusGeral).toBe('PRONTA')
  })

  it('rejeita como desatualizada uma exposicao da data com referencias temporais antigas', () => {
    const base = montarBaseFinanceiraDaData({ dataOperacional: '2026-08-24', importacoes: [], snapshots: [] })
    expect(execucaoExposicaoCompativelComBase({
      data_operacional: '2026-08-24',
      data_referencia_estoque: '2026-08-21',
      data_referencia_pl: '2026-08-18',
    }, base)).toBe(false)
    expect(execucaoExposicaoCompativelComBase({
      data_operacional: '2026-08-24',
      data_referencia_estoque: '2026-08-21',
      data_referencia_pl: '2026-08-20',
    }, base)).toBe(true)
  })
})

