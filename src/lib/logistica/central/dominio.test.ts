import { describe, expect, it } from 'vitest'
import {
  agregarCtesCentral,
  classificarMomentoDocumento,
  classificarStatusAtual,
  diferencaDiasCivis,
  filtrarNotasCentral,
  projetarDocumentoLogistico,
  resolverDataCessaoConfiavel,
} from './dominio'
import { parseFiltrosCentralLogistica } from './filtros'
import type { DocumentoLogisticoCentral, LogisticaNfResumo } from './tipos'

function documento(overrides: Partial<DocumentoLogisticoCentral> = {}): DocumentoLogisticoCentral {
  return {
    familia: 'cte', status: 'NAO_ENVIADO', documentoId: null, versaoAtualId: null,
    versaoAprovadaId: null, primeiraVersao: null, versaoAtual: null,
    primeiraVersaoNome: null, versaoAtualNome: null, primeiroUploadEm: null,
    ultimoUploadEm: null, aprovadoEm: null, momento: 'INDETERMINADO',
    diasRelativosCessao: null, quantidadeNfs: 1, prazoOriginal: null,
    novaPrevisao: null, prazoEfetivo: null, obrigatorio: true, ...overrides,
  }
}

function nota(overrides: Partial<LogisticaNfResumo> = {}): LogisticaNfResumo {
  return {
    notaFiscalId: 'nf-1', numeroNf: '13197', chaveAcesso: '44-digitos', cedente: 'Cedente A',
    cedenteCnpj: '001', sacado: 'Sacado A', sacadoCnpj: '002', valor: 100,
    emissao: '2026-08-01', vencimento: '2026-09-01', operacao: null,
    statusAtual: 'INDETERMINADA', statusCriacao: null, statusAprovacao: null,
    gateObrigatorio: false, cte: documento(), referenciasCte: [],
    comprovante: documento({ familia: 'comprovante_entrega' }),
    cumprimentoDocumental: { obrigatorios: 2, aprovados: 0, pendentes: 2, completo: false },
    prazoRelevante: { documento: null, data: null, prazoOriginal: null, novaPrevisao: null, dias: null, situacao: 'sem_pendencia' },
    criticidade: 'NORMAL', pendencias: [], ultimaAtualizacao: '2026-08-01T00:00:00Z', ...overrides,
  }
}

describe('dominio da central logistica', () => {
  it('usa somente marcos confiaveis para resolver a cessao', () => {
    expect(resolverDataCessaoConfiavel({ cessaoEfetivadaEm: '2026-08-03', aprovadoEm: '2026-08-01', politicaSnapshot: { cessao_no_desembolso: true } })).toBe('2026-08-03')
    expect(resolverDataCessaoConfiavel({ cessaoEfetivadaEm: null, aprovadoEm: '2026-08-01', politicaSnapshot: { cessao_no_desembolso: false } })).toBe('2026-08-01')
    expect(resolverDataCessaoConfiavel({ cessaoEfetivadaEm: null, aprovadoEm: '2026-08-01', politicaSnapshot: { cessao_no_desembolso: true } })).toBeNull()
  })

  it('classifica o momento pelo primeiro upload e preserva dias civis', () => {
    expect(classificarMomentoDocumento('2026-08-01T23:00:00Z', '2026-08-02T10:00:00Z')).toEqual({ momento: 'ANTECIPADO', diasRelativosCessao: -1 })
    expect(classificarMomentoDocumento('2026-08-02T10:00:00Z', '2026-08-02T10:00:00Z')).toEqual({ momento: 'POS_CESSAO', diasRelativosCessao: 0 })
    expect(classificarMomentoDocumento('2026-08-02', null).momento).toBe('INDETERMINADO')
    expect(diferencaDiasCivis('2026-08-01', '2026-08-03')).toBe(2)
  })

  it('prioriza comprovante aprovado sobre CT-e aprovado', () => {
    const cte = documento({ familia: 'cte', status: 'APROVADO', documentoId: 'doc-cte', versaoAtualId: 'v-cte' })
    const comprovante = documento({ familia: 'comprovante_entrega', status: 'APROVADO', documentoId: 'doc-proof', versaoAtualId: 'v-proof' })
    expect(classificarStatusAtual(cte, comprovante)).toBe('ENTREGUE')
    expect(classificarStatusAtual(cte, documento({ familia: 'comprovante_entrega' }))).toBe('EM_TRANSITO')
  })

  it('separa primeira versao, versao atual e versao aprovada', () => {
    const result = projetarDocumentoLogistico({
      familia: 'cte', documentoId: 'doc', versaoAprovadaId: 'v1', obrigatorio: true,
      prazoOriginal: null, novaPrevisao: null,
      versoes: [
        { id: 'v1', documentoId: 'doc', numero: 1, nome: 'primeiro.xml', status: 'aprovado', enviadoEm: '2026-08-01T10:00:00Z' },
        { id: 'v2', documentoId: 'doc', numero: 2, nome: 'atual.xml', status: 'enviado', enviadoEm: '2026-08-03T10:00:00Z' },
      ], analises: [{ id: 'a1', versaoId: 'v1', resultado: 'aprovado', analisadoEm: '2026-08-02T10:00:00Z', analisadoPor: 'gestor' }],
    }, '2026-08-02T12:00:00Z')
    expect(result.primeiroUploadEm).toBe('2026-08-01T10:00:00Z')
    expect(result.versaoAtual).toBe(2)
    expect(result.versaoAprovadaId).toBe('v1')
    expect(result.status).toBe('AGUARDANDO_ANALISE')
    expect(result.momento).toBe('ANTECIPADO')
  })

  it('filtra no servidor por referencias do CT-e e combinacao de filtros', () => {
    const filtros = parseFiltrosCentralLogistica({ q: 'cte-999', statusLogistico: 'EM_TRANSITO', page: '1' })
    const nfs = [nota({ statusAtual: 'EM_TRANSITO', referenciasCte: ['CTE-999'] }), nota({ notaFiscalId: 'nf-2', numeroNf: '2' })]
    expect(filtrarNotasCentral(nfs, filtros).map((item) => item.notaFiscalId)).toEqual(['nf-1'])
  })

  it('normaliza e aplica filtros combinados de contexto, documentos e periodo', () => {
    const filtros = parseFiltrosCentralLogistica({
      tab: 'notas', q: 'cte-alvo', cedente: '001', sacado: '002', operacao: 'op-1',
      statusLogistico: 'ENTREGUE', statusCte: 'APROVADO', statusComprovante: 'APROVADO',
      momentoCte: 'ANTECIPADO', momentoComprovante: 'POS_CESSAO', pendencia: 'sem_pendencia',
      statusOperacao: 'em_andamento', periodo: 'emissao', dataDe: '2026-08-01', dataAte: '2026-08-01',
    })
    const alvo = nota({
      notaFiscalId: 'nf-alvo', referenciasCte: ['CTE-ALVO'], statusAtual: 'ENTREGUE',
      cte: documento({ status: 'APROVADO', momento: 'ANTECIPADO' }),
      comprovante: documento({ familia: 'comprovante_entrega', status: 'APROVADO', momento: 'POS_CESSAO' }),
      operacao: {
        id: 'op-1', status: 'em_andamento', criadaEm: '2026-07-30T10:00:00Z',
        aprovadaEm: '2026-07-31T10:00:00Z', desembolsadaEm: '2026-08-01T10:00:00Z',
        dataCessao: '2026-08-01T10:00:00Z',
      },
    })
    const foraDoPeriodo = nota({
      notaFiscalId: 'nf-fora', emissao: '2026-07-31', referenciasCte: ['CTE-ALVO'],
      statusAtual: 'ENTREGUE',
      cte: documento({ status: 'APROVADO', momento: 'ANTECIPADO' }),
      comprovante: documento({ familia: 'comprovante_entrega', status: 'APROVADO', momento: 'POS_CESSAO' }),
      operacao: alvo.operacao,
    })

    expect(filtros).toMatchObject({
      tab: 'notas', statusLogistico: 'ENTREGUE', statusCte: 'APROVADO',
      statusComprovante: 'APROVADO', momentoCte: 'ANTECIPADO',
      momentoComprovante: 'POS_CESSAO', dataDe: '2026-08-01', dataAte: '2026-08-01',
    })
    expect(filtrarNotasCentral([alvo, foraDoPeriodo], filtros).map((item) => item.notaFiscalId)).toEqual(['nf-alvo'])
  })

  it('agrega uma linha por CT-e no relacionamento N:N e soma cada NF uma vez', () => {
    const doc = documento({ familia: 'cte', status: 'APROVADO', primeiroUploadEm: '2026-08-01' })
    const result = agregarCtesCentral([
      { cteId: 'cte-1', chave: 'chave', numero: '1', cedente: 'Cedente', cedenteCnpj: '001', documento: doc, nota: nota({ notaFiscalId: 'nf-1', valor: 100 }) },
      { cteId: 'cte-1', chave: 'chave', numero: '1', cedente: 'Cedente', cedenteCnpj: '001', documento: doc, nota: nota({ notaFiscalId: 'nf-2', valor: 200 }) },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ quantidadeNfs: 2, valorRelacionado: 300 })
  })
})
