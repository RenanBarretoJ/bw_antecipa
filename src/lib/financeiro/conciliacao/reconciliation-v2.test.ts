import { describe, expect, it } from 'vitest'
import { identidadeCanonicaConciliacao, reconciliarTitulosV2 } from './reconciliation-v2'
import type { ReconciliationRow } from './types'

const row = (key = 'T1', principal = '100', overrides: Partial<ReconciliationRow> = {}): ReconciliationRow => ({
  identidadeExterna: key, fundoId: 'f1', provedor: 'QA', cedenteDocumento: '12345678000199',
  valorPrincipal: principal, valorAquisicao: '90', ...overrides,
})
const run = (d2: ReconciliationRow[], d1: ReconciliationRow[], acq: ReconciliationRow[] = [], liq: ReconciliationRow[] = []) => reconciliarTitulosV2({
  fundoId: 'f1', estoqueD2: d2, estoqueD1: d1, aquisicoesD1: acq, liquidacoesD1: liq,
  aquisicoesRecebidas: acq.length > 0, liquidacoesRecebidas: liq.length > 0,
})

describe('FIN_RECON_V2 por chave e saldo principal', () => {
  it('usa a mesma precedencia de identidade do diagnostico SQL sem recorrer a chave da NF', () => {
    expect(identidadeCanonicaConciliacao({ external_title_key: 'PARCELA', id_recebivel: 'ATIVO', seu_numero: 'NUM' })).toBe('PARCELA')
    expect(identidadeCanonicaConciliacao({ external_title_key: '', id_recebivel: 'ATIVO', seu_numero: 'NUM' })).toBe('ATIVO')
    expect(identidadeCanonicaConciliacao({ id_recebivel: null, seu_numero: 'NUM' })).toBe('NUM')
    expect(identidadeCanonicaConciliacao({ chave_nfe: 'NF-COM-DUAS-PARCELAS' })).toBeNull()
  })
  it('concilia estoques iguais sem fabricar relatorios vazios', () => {
    const result = run([row()], [row()])[0]
    expect(result.status).toBe('MANTIDO_CORRETO')
    expect(result.detalhes).toMatchObject({ saldo_principal_conferido: true, aquisicoes_relatorio_recebido: false, liquidacoes_relatorio_recebido: false })
  })
  it('valor de compra historico diferente nao e prova de baixa de principal', () => {
    expect(run([row()], [row('T1', '100', { valorAquisicao: '90.13' })])[0].status).toBe('MANTIDO_CORRETO')
  })
  it('totais iguais nao escondem troca de titulos', () => {
    expect(run([row('ANTIGO')], [row('NOVO')]).map(r => r.status).sort())
      .toEqual(['ENTRADA_SEM_AQUISICAO', 'SAIDA_SEM_LIQUIDACAO'])
  })
  it('aquisicao precisa explicar o principal incorporado, nao apenas existir', () => {
    expect(run([], [row()], [row()])[0].status).toBe('ENTRADA_INCORPORADA')
    expect(run([], [row()], [row('T1', '99')])[0].status).toBe('DIVERGENCIA_VALOR')
  })
  it('baixa total exige principal baixado compativel', () => {
    expect(run([row()], [], [], [row('T1', '100', { valorPrincipalBaixado: '100', valorMovimento: '103' })])[0].status).toBe('SAIDA_REFLETIDA')
    expect(run([row()], [], [], [row('T1', '100', { valorPrincipalBaixado: '99' })])[0].status).toBe('DIVERGENCIA_VALOR')
  })
  it('baixa parcial exige descricao e equacao exata de principal', () => {
    const liq = row('T1', '100', { valorPrincipalBaixado: '40', valorMovimento: '43', tipoMovimento: 'BAIXA PARCIAL' })
    const result = run([row()], [row('T1', '60')], [], [liq])[0]
    expect(result.status).toBe('LIQUIDACAO_PARCIAL_SALDO')
    expect(result.detalhes).toMatchObject({ principal_baixado: '40.0000', principal_d1: '60.0000', baixa_parcial_comprovada: true })
    expect(run([row()], [row('T1', '61')], [], [liq])[0].status).toBe('DIVERGENCIA_VALOR')
    expect(run([row()], [row('T1', '60')], [], [{ ...liq, tipoMovimento: 'BAIXA TOTAL' }])[0].status).toBe('DIVERGENCIA_VALOR')
  })
  it('nao confunde valor pago ou nominal original com principal amortizado', () => {
    const result = run([row()], [row('T1', '60')], [], [row('T1', '100', { valorMovimento: '40', tipoMovimento: 'PARCIAL' })])[0]
    expect(result.status).toBe('DIVERGENCIA_VALOR')
    expect(result.detalhes.principal_baixa_nao_comprovado).toBe(true)
  })
  it('mesma chave em cedentes distintos nao colide', () => {
    const other = row('T1', '200', { cedenteDocumento: '98765432000199' })
    const results = run([row(), other], [other, row()])
    expect(results).toHaveLength(2)
    expect(results.every(r => r.status === 'MANTIDO_CORRETO')).toBe(true)
  })
  it('nao ignora movimentacao recebida quando estoque ficou igual', () => {
    expect(run([row()], [row()], [row()])[0].status).toBe('DIVERGENCIA_VALOR')
  })
  it('preserva deteccao de liquidacoes repetidas', () => {
    const liq = row('T1', '100', { valorPrincipalBaixado: '20', tipoMovimento: 'PARCIAL' })
    expect(run([row()], [row('T1', '60')], [], [liq, liq])[0].status).toBe('LIQUIDACAO_REPETIDA_MESMO_DIA')
  })
  it('mantem precisao acima do limite inteiro do JavaScript', () => {
    const result = run([row('T1', '9007199254740993.0300')], [row('T1', '9007199254740993.0200')], [],
      [row('T1', '100', { valorPrincipalBaixado: '0.0100', tipoMovimento: 'PARCIAL' })])[0]
    expect(result.status).toBe('LIQUIDACAO_PARCIAL_SALDO')
  })
  it.each([
    { fundoId: 'outro-fundo' }, { identidadeExterna: null }, { cedenteDocumento: null },
    { valorPrincipal: null }, { valorPrincipal: 'NaN' }, { valorPrincipal: '-1' },
  ])('rejeita linha invalida em vez de conciliar por omissao: %j', changes => {
    expect(() => run([row('T1', '100', changes)], [row()])).toThrow()
  })
  it('rejeita duplicidade sem deduplicacao cega', () => {
    expect(() => run([row(), row()], [row()])).toThrow('duplicada')
  })
})
