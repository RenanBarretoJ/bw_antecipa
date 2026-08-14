import { describe, expect, it } from 'vitest'
import { classificarStatusLogisticoPreCessao } from '@/lib/logistica/evidencias-logisticas'
import { projetarPosicaoLogistica, somarValoresConhecidos } from './snapshot'
import { criarAssinaturaPosicaoLogistica, criarFingerprintLogistico } from './fingerprint'

const stock = { id: 'stock-1', valor_aquisicao: '100.25', valor_nominal: '110.00', id_recebivel: 'R1' }
const match = { id: 'match-1', origem_registro_id: 'stock-1', status: 'MATCH_FORTE', metodo: 'ID_RECEBIVEL', nota_fiscal_id: 'nf-1', vinculo_id: 'link-1' }

describe('snapshot logistico RLX', () => {
  it.each([
    ['comprovante_entrega', 'ENTREGUE'],
    ['cte', 'EM_TRANSITO'],
  ] as const)('classifica evidencia %s como %s', (familia, expected) => {
    const classification = classificarStatusLogisticoPreCessao([{ familia, documentoId: 'doc', versaoId: 'v1', versaoStatus: 'aprovado' }])
    const row = projetarPosicaoLogistica({ estoque: stock, matching: match, classificacao: classification, nfCompartilhada: false })
    expect(row.statusLogistico).toBe(expected)
  })

  it('classifica match sem evidencia como INDETERMINADA', () => {
    const row = projetarPosicaoLogistica({ estoque: stock, matching: match, classificacao: classificarStatusLogisticoPreCessao([]), nfCompartilhada: false })
    expect(row.statusLogistico).toBe('INDETERMINADA')
  })

  it('mantem sem match separado da classificacao logistica', () => {
    const row = projetarPosicaoLogistica({ estoque: stock, matching: { ...match, status: 'AMBIGUO', nota_fiscal_id: null }, classificacao: null, nfCompartilhada: false })
    expect(row.statusVinculo).toBe('SEM_MATCH_FINANCEIRO_NF')
    expect(row.statusLogistico).toBeNull()
  })

  it.each(['AMBIGUO', 'CONFLITO', 'NAO_CONCILIADO'] as const)('nao aproxima NF para matching %s', (status) => {
    const row = projetarPosicaoLogistica({ estoque: stock, matching: { ...match, status, nota_fiscal_id: null }, classificacao: null, nfCompartilhada: false })
    expect(row.statusVinculo).toBe('SEM_MATCH_FINANCEIRO_NF')
    expect(row.notaFiscalId).toBeNull()
    expect(row.statusLogistico).toBeNull()
  })

  it('preserva o vinculo manual resolvido pelo P2.3 sem refazer matching', () => {
    const row = projetarPosicaoLogistica({ estoque: stock, matching: { ...match, metodo: 'MANUAL' }, classificacao: classificarStatusLogisticoPreCessao([]), nfCompartilhada: false })
    expect(row.matchingMetodo).toBe('MANUAL')
    expect(row.vinculoId).toBe('link-1')
  })

  it('nao promove evidencias pendentes ou rejeitadas', () => {
    const classification = classificarStatusLogisticoPreCessao([
      { familia: 'cte', documentoId: 'cte-pendente', versaoId: 'v1', versaoStatus: 'enviado' },
      { familia: 'comprovante_entrega', documentoId: 'proof-rejeitado', versaoId: 'v2', versaoStatus: 'rejeitado', analiseResultado: 'rejeitado' },
    ])
    expect(classification.status).toBe('INDETERMINADA')
  })

  it('preserva valor de aquisicao ausente sem converte-lo em zero', () => {
    const missing = projetarPosicaoLogistica({ estoque: { ...stock, valor_aquisicao: null }, matching: null, classificacao: null, nfCompartilhada: false })
    expect(missing.valorAquisicao).toBeNull()
    expect(missing.valorAquisicaoQualidade).toBe('AUSENTE')
    expect(somarValoresConhecidos([missing]).total).toBeNull()
  })

  it('soma com Decimal e sinaliza NF compartilhada entre posicoes', () => {
    const first = projetarPosicaoLogistica({ estoque: stock, matching: match, classificacao: classificarStatusLogisticoPreCessao([]), nfCompartilhada: true })
    const second = { ...first, estoquePosicaoId: 'stock-2', valorAquisicao: '0.10' }
    expect(first.nfCompartilhadaEntrePosicoes).toBe(true)
    expect(somarValoresConhecidos([first, second]).total).toBe('100.35')
  })

  it('mantem fingerprint e assinatura idempotentes para a mesma evidencia', () => {
    const classificacoes = new Map([['nf-1', classificarStatusLogisticoPreCessao([
      { familia: 'cte' as const, documentoId: 'doc', versaoId: 'v1', versaoStatus: 'aprovado' },
    ])]])
    const fingerprint = criarFingerprintLogistico(classificacoes)
    const input = { fundoId: 'fundo', estoqueImportacaoId: 'estoque', matchingExecucaoId: 'matching', fingerprintLogistico: fingerprint, regraVersao: 'RLX_LOGISTICA_V1' }
    expect(criarFingerprintLogistico(classificacoes)).toBe(fingerprint)
    expect(criarAssinaturaPosicaoLogistica(input)).toBe(criarAssinaturaPosicaoLogistica(input))
  })

  it('gera novo fingerprint quando comprovante aprovado altera transito para entregue', () => {
    const emTransito = new Map([['nf-1', classificarStatusLogisticoPreCessao([
      { familia: 'cte' as const, documentoId: 'cte', versaoId: 'v1', versaoStatus: 'aprovado' },
    ])]])
    const entregue = new Map([['nf-1', classificarStatusLogisticoPreCessao([
      { familia: 'cte' as const, documentoId: 'cte', versaoId: 'v1', versaoStatus: 'aprovado' },
      { familia: 'comprovante_entrega' as const, documentoId: 'proof', versaoId: 'v2', versaoStatus: 'aprovado' },
    ])]])
    expect(emTransito.get('nf-1')?.status).toBe('EM_TRANSITO')
    expect(entregue.get('nf-1')?.status).toBe('ENTREGUE')
    expect(criarFingerprintLogistico(emTransito)).not.toBe(criarFingerprintLogistico(entregue))
  })

  it('gera nova assinatura para retificacao de estoque ou novo matching', () => {
    const base = { fundoId: 'fundo', estoqueImportacaoId: 'estoque-v1', matchingExecucaoId: 'matching-v1', fingerprintLogistico: 'fingerprint', regraVersao: 'RLX_LOGISTICA_V1' }
    const original = criarAssinaturaPosicaoLogistica(base)
    expect(criarAssinaturaPosicaoLogistica({ ...base, estoqueImportacaoId: 'estoque-v2' })).not.toBe(original)
    expect(criarAssinaturaPosicaoLogistica({ ...base, matchingExecucaoId: 'matching-v2' })).not.toBe(original)
  })
})
