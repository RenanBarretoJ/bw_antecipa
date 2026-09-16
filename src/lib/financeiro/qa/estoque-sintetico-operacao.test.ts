import { describe, expect, it } from 'vitest'
import { processarArquivoRlx } from '../ingestao/parser'
import { datasEstoqueQa, gerarCsvEstoqueQa, validarOperacaoEstoqueQa, type OperacaoEstoqueQa } from './estoque-sintetico-operacao'

const fundoId = 'c0f501d1-acec-4626-b024-283f03cae392'
const operacaoId = 'cf41453d-4722-42d2-8626-0ef64a473ed8'
const base: OperacaoEstoqueQa = {
  fundoId, operacaoId, fundoNome: 'Fundo QA', fundoCnpj: '68522785000104',
  numeroNf: '149', chaveNfe: '32260707312248000641550030000001491633279034',
  cedenteNome: 'Cedente QA', cedenteCnpj: '07312248000641', sacadoNome: 'Sacado QA', sacadoCnpj: '04180759000235',
  emissao: '2026-07-27', aquisicao: '2026-08-25', valorBrutoTotal: '31552.00', precoAquisicao: '30157.60',
  parcelas: [
    { parcelaId: 'd8c3df6c-0b59-407c-af06-cc76772af730', numeroParcela: 1, valorNominal: '10517.33', valorAquisicao: '10420.04', vencimento: '2026-08-31', status: 'em_operacao' },
    { parcelaId: '3b6189ec-ff1e-4214-81b3-177305dde72a', numeroParcela: 2, valorNominal: '10517.33', valorAquisicao: '10086.56', vencimento: '2026-09-21', status: 'em_operacao' },
    { parcelaId: '3aab32f9-95f3-4400-81cb-91f8d9463bb2', numeroParcela: 3, valorNominal: '10517.34', valorAquisicao: '9651.00', vencimento: '2026-10-19', status: 'em_operacao' },
  ],
}

describe('estoque sintetico de operacao em homolog', () => {
  it('gera 15 snapshots em dias uteis ANBIMA, incluindo D-2 e D-1', () => {
    const datas = datasEstoqueQa('2026-08-25', '2026-09-15')
    expect(datas).toHaveLength(15)
    expect(datas).toContain('2026-09-14')
    expect(datas).toContain('2026-09-15')
    expect(datas).not.toContain('2026-09-07')
    expect(datas).not.toContain('2026-09-12')
  })

  it('cria tres titulos estaveis por parcela e valida pelo parser oficial', () => {
    const ids = new Set<string>()
    for (const data of ['2026-09-14', '2026-09-15']) {
      const resultado = processarArquivoRlx({
        arquivo: gerarCsvEstoqueQa(base, data), tipoBase: 'ESTOQUE', fundoId,
        dataReferencia: data, provedor: 'qa_synthetic_operacao',
      })
      expect(resultado.completude).toBe('COMPLETO_COM_DADOS')
      expect(resultado.errosArquivo).toEqual([])
      expect(resultado.linhas).toHaveLength(3)
      expect(resultado.linhas.every((linha) => linha.status !== 'INVALIDA')).toBe(true)
      expect(resultado.valorTotal).toBe('31552.0000')
      const current = new Set(resultado.linhas.map((linha) => linha.dadosNormalizados.id_recebivel))
      expect(current.size).toBe(3)
      if (ids.size) expect(current).toEqual(ids)
      current.forEach((id) => ids.add(id))
    }
  })

  it('bloqueia divergencia financeira e parcela nao aberta', () => {
    expect(() => validarOperacaoEstoqueQa({ ...base, precoAquisicao: '1.00' })).toThrow('diverge')
    expect(() => validarOperacaoEstoqueQa({ ...base, parcelas: [{ ...base.parcelas[0], status: 'liquidada' }] })).toThrow('status')
  })

  it('rejeita intervalo invertido ou excessivo', () => {
    expect(() => datasEstoqueQa('2026-09-15', '2026-09-14')).toThrow('anterior')
    expect(() => datasEstoqueQa('2026-08-25', '2026-11-01')).toThrow('60 dias')
  })
})
