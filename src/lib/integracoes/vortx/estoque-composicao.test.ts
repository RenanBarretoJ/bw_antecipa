import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { classificarStatusLogisticoPreCessao } from '@/lib/logistica/evidencias-logisticas'
import { projetarPosicaoLogistica } from '@/lib/financeiro/logistica/snapshot'
import { CONTEXTO_CSV_QA, relatorioVortxQa } from './__fixtures__/relatorios-csv'
import { comporEstoqueVortx } from './estoque-composicao'

describe('composicao Vortx por ativo e parcela', () => {
  it('herda estado inicial do ativo sem expor um status gerencial automatico', () => {
    const result = comporEstoqueVortx(relatorioVortxQa('PosicaoAtivo'), relatorioVortxQa('PosicaoParcela'))
    expect(result.resumo.statusEntrada).toEqual({ EM_TRANSITO: 1, ENTREGUE: 0, NAO_INFORMADO: 0 })
    expect(result.posicoes[0].fonteStatusEntrada).toBe('PosicaoAtivo')
    expect(result.posicoes[0].financeiro).not.toHaveProperty('status_logistico')
    expect(result.posicoes[0].financeiro).not.toHaveProperty('numero_documento')
    expect(result.publicacaoHabilitada).toBe(true)
    expect(result.reconciliado).toBe(true)
  })

  it('nao confunde cedentes diferentes com a mesma chave de ativo/parcela', () => {
    const ativos = relatorioVortxQa('PosicaoAtivo', [{ status_entrada_provedor: 'Entregue' }, { cedente_documento: '98992300000441' }])
    const parcelas = relatorioVortxQa('PosicaoParcela', [{}, { cedente_documento: '98992300000441' }])
    const result = comporEstoqueVortx(ativos, parcelas)
    expect(result.posicoes.map((row) => row.statusEntradaProvedor)).toEqual(['ENTREGUE', 'EM_TRANSITO'])
    expect(new Set(result.posicoes.map((row) => row.financeiro.id_recebivel)).size).toBe(2)
  })

  it('suporta duas parcelas por ativo sem duplicar valor consolidado nem o valor de emissao', () => {
    const parcelas = relatorioVortxQa('PosicaoParcela', [
      { chave_parcela: 'P1', valor_nominal: '40.00', valor_aquisicao: '36.00', valor_presente: '36.40', valor_pdd: '0.80' },
      { chave_parcela: 'P2', valor_nominal: '60.00', valor_aquisicao: '54.00', valor_presente: '54.60', valor_pdd: '1.20' },
    ])
    const result = comporEstoqueVortx(relatorioVortxQa('PosicaoAtivo'), parcelas)
    expect(result.reconciliado).toBe(true)
    expect(result.resumo).toMatchObject({ ativos: 1, parcelas: 2 })
    expect(result.posicoes.reduce((sum, row) => sum.plus(row.financeiro.valor_aquisicao), new Decimal(0)).toFixed(2)).toBe('90.00')
    expect(result.posicoes[0].financeiro).not.toHaveProperty('valor_emissao_total_ativo')
  })

  it('preserva PDD divergente em vez de sobrescrever ou distribuir o valor do ativo', () => {
    const result = comporEstoqueVortx(relatorioVortxQa('PosicaoAtivo'), relatorioVortxQa('PosicaoParcela', [{ valor_pdd: '0.00' }]))
    expect(result.reconciliado).toBe(false)
    expect(result.divergencias).toContainEqual({ linhaAtivo: 2, campo: 'valor_pdd', codigo: 'TOTAL_DIVERGENTE' })
    expect(result.posicoes[0].financeiro.valor_pdd).toBe('0.0000')
    expect(result.posicoes[0].ativo.dadosNormalizados.valor_pdd).toBe('2.0000')
    expect(result.publicacaoHabilitada).toBe(false)
  })

  it('reconcilia valores acima do limite inteiro seguro do JavaScript sem perder centavos', () => {
    const valor = '9007199254740993.03'
    const ativos = relatorioVortxQa('PosicaoAtivo', [{ valor_nominal: valor, valor_aquisicao: valor, valor_presente: valor }])
    const parcelas = relatorioVortxQa('PosicaoParcela', [
      { chave_parcela: 'P1', valor_nominal: '4503599627370496.01', valor_aquisicao: '4503599627370496.01', valor_presente: '4503599627370496.01', valor_pdd: '1.00' },
      { chave_parcela: 'P2', valor_nominal: '4503599627370497.02', valor_aquisicao: '4503599627370497.02', valor_presente: '4503599627370497.02', valor_pdd: '1.00' },
    ])
    expect(comporEstoqueVortx(ativos, parcelas).reconciliado).toBe(true)
    expect(ativos.linhas[0].dadosNormalizados.valor_nominal).toBe('9007199254740993.0300')
  })

  it('mantem valor ausente e status inicial nao informado sem preenchimento ficticio', () => {
    const result = comporEstoqueVortx(relatorioVortxQa('PosicaoAtivo', [{ status_entrada_provedor: '' }]), relatorioVortxQa('PosicaoParcela', [{ valor_pdd: '' }]))
    expect(result.resumo.statusEntrada.NAO_INFORMADO).toBe(1)
    expect(result.posicoes[0].financeiro.valor_pdd).toBe('')
    expect(result.divergencias).toContainEqual({ linhaAtivo: 2, campo: 'valor_pdd', codigo: 'VALOR_AUSENTE' })
  })

  it.each([
    { fundoId: 'c4cfda85-b7cf-4f10-9db3-095820d73906' }, { ambiente: 'producao' as const },
    { dataReferencia: '2026-10-15' }, { codigoCarteira: 'OUTRA' },
  ])('rejeita associacao entre contextos diferentes: %j', (patch) => {
    const parcelas = relatorioVortxQa('PosicaoParcela', [{ codigo_carteira: patch.codigoCarteira ?? CONTEXTO_CSV_QA.codigoCarteira }], { ...CONTEXTO_CSV_QA, ...patch })
    expect(() => comporEstoqueVortx(relatorioVortxQa('PosicaoAtivo'), parcelas))
      .toThrow(expect.objectContaining({ codigo: 'ESCOPO_DIVERGENTE' }))
  })

  it('rejeita parcela orfa, ativo sem parcelas, duplicidade e devedor divergente', () => {
    const ativo = relatorioVortxQa('PosicaoAtivo')
    expect(() => comporEstoqueVortx(ativo, relatorioVortxQa('PosicaoParcela', [{ chave_ativo: 'OUTRO' }]))).toThrow('sem ativo')
    expect(() => comporEstoqueVortx(relatorioVortxQa('PosicaoAtivo', [{}, { chave_ativo: 'OUTRO' }]), relatorioVortxQa('PosicaoParcela'))).toThrow('cobertura integral')
    expect(() => comporEstoqueVortx(ativo, relatorioVortxQa('PosicaoParcela', [{}, {}]))).toThrow('validas e completas')
    expect(() => comporEstoqueVortx(ativo, relatorioVortxQa('PosicaoParcela', [{ sacado_documento: '98992300000441' }]))).toThrow('Sacado divergente')
    expect(() => comporEstoqueVortx(ativo, relatorioVortxQa('Inclusao'))).toThrow('validas e completas')
  })

  it('rejeita estados de entrada conflitantes e aceita estado explicitamente presente na parcela', () => {
    expect(() => comporEstoqueVortx(relatorioVortxQa('PosicaoAtivo'), relatorioVortxQa('PosicaoParcela', [{ status_entrada_provedor: 'Entregue' }]))).toThrow('Estados de entrada divergentes')
    const result = comporEstoqueVortx(relatorioVortxQa('PosicaoAtivo', [{ status_entrada_provedor: '' }]), relatorioVortxQa('PosicaoParcela', [{ status_entrada_provedor: 'Entregue' }]))
    expect(result.posicoes[0].fonteStatusEntrada).toBe('PosicaoParcela')
    expect(result.posicoes[0].statusEntradaProvedor).toBe('ENTREGUE')
  })

  it('reimportar estado de entrada em transito nao regride entrega interna aprovada', () => {
    const ativos = relatorioVortxQa('PosicaoAtivo'), parcelas = relatorioVortxQa('PosicaoParcela')
    const antes = JSON.stringify({ ativos, parcelas })
    const row = comporEstoqueVortx(ativos, parcelas).posicoes[0]
    const snapshot = projetarPosicaoLogistica({
      estoque: { id: 'posicao-qa', ...row.financeiro },
      matching: { id: 'match-qa', origem_registro_id: 'posicao-qa', status: 'MATCH_FORTE', nota_fiscal_id: 'nf-qa' },
      classificacao: classificarStatusLogisticoPreCessao([{ familia: 'comprovante_entrega', documentoId: 'doc-qa', versaoId: 'v1', versaoStatus: 'aprovado' }]),
      nfCompartilhada: false,
    })
    expect(row.statusEntradaProvedor).toBe('EM_TRANSITO')
    expect(snapshot.statusLogistico).toBe('ENTREGUE')
    expect(JSON.stringify({ ativos, parcelas })).toBe(antes)
  })

  it('estado de entrada entregue nao fabrica evidencia interna nem matching', () => {
    const row = comporEstoqueVortx(relatorioVortxQa('PosicaoAtivo', [{ status_entrada_provedor: 'Entregue' }]), relatorioVortxQa('PosicaoParcela')).posicoes[0]
    const snapshot = projetarPosicaoLogistica({ estoque: { id: 'posicao-qa', ...row.financeiro }, matching: null, classificacao: null, nfCompartilhada: false })
    expect(row.statusEntradaProvedor).toBe('ENTREGUE')
    expect(snapshot.statusLogistico).toBeNull()
    expect(snapshot.notaFiscalId).toBeNull()
  })
})
