import { describe, expect, it } from 'vitest'
import type {
  ConciliacaoExecucao,
  ExposicaoExecucao,
  MatchingExecucao,
  PosicaoLogisticaExecucao,
  RiscoExecucao,
} from '@/types/database'
import type { BaseFinanceiraDaData, BaseFinanceiraResolvida } from './base-financeira'
import type { PoliticaFinanceiraDaData } from './loaders.server'
import { resolverStatusEsteiraFinanceira, type ResolverStatusEsteiraFinanceiraInput } from './pipeline-status.server'

const IDS = {
  estoqueD2: '10000000-0000-4000-8000-000000000001',
  estoqueD1: '10000000-0000-4000-8000-000000000002',
  aquisicoes: '10000000-0000-4000-8000-000000000003',
  liquidacoes: '10000000-0000-4000-8000-000000000004',
  pl: '10000000-0000-4000-8000-000000000005',
  matching: '20000000-0000-4000-8000-000000000001',
  conciliacao: '20000000-0000-4000-8000-000000000002',
  logistica: '20000000-0000-4000-8000-000000000003',
  exposicao: '20000000-0000-4000-8000-000000000004',
  risco: '20000000-0000-4000-8000-000000000005',
  politica: '30000000-0000-4000-8000-000000000001',
}

function baseItem(tipo: BaseFinanceiraResolvida['tipo'], importacaoId: string, estado: BaseFinanceiraResolvida['estado'] = 'VALOR'): BaseFinanceiraResolvida {
  return {
    tipo,
    dataEsperada: tipo === 'ESTOQUE' && importacaoId === IDS.estoqueD2 ? '2026-09-11' : '2026-09-14',
    dataReferencia: estado === 'INDISPONIVEL' ? null : tipo === 'CARTEIRA' ? '2026-09-11' : '2026-09-14',
    defasagem: tipo === 'CARTEIRA' && estado !== 'INDISPONIVEL' ? 'D-2' : null,
    estado,
    valor: ['VALOR', 'ZERO'].includes(estado) ? (estado === 'ZERO' ? '0.0000' : '100.0000') : null,
    importacaoId: estado === 'INDISPONIVEL' ? null : importacaoId,
    origem: estado === 'INDISPONIVEL' ? null : 'PORTAL_FIDC',
    provedor: estado === 'INDISPONIVEL' ? null : 'sinqia',
    origemQa: false,
  }
}

function baseCompleta(): BaseFinanceiraDaData {
  return {
    dataOperacional: '2026-09-15',
    dataD1: '2026-09-14',
    dataD2: '2026-09-11',
    estoqueD2: { ...baseItem('ESTOQUE', IDS.estoqueD2), dataReferencia: '2026-09-11', dataEsperada: '2026-09-11' },
    estoque: baseItem('ESTOQUE', IDS.estoqueD1),
    aquisicoes: baseItem('AQUISICOES', IDS.aquisicoes),
    liquidacoes: baseItem('LIQUIDACOES', IDS.liquidacoes),
    carteira: { ...baseItem('CARTEIRA', IDS.pl), dataReferencia: '2026-09-11', dataEsperada: '2026-09-11' },
    statusGeral: 'PRONTA',
  }
}

const politicaAplicavel: PoliticaFinanceiraDaData = {
  estado: 'APLICAVEL',
  nome: 'Política padrão',
  versao: 3,
  versaoId: IDS.politica,
  criaAcompanhamentoEntrega: true,
  controleExposicaoAtivo: true,
  gateRiscoAtivo: true,
  limitePct: '20',
}

function matching(overrides: Partial<MatchingExecucao> = {}): MatchingExecucao {
  return {
    id: IDS.matching, fundo_id: 'fundo', data_referencia: '2026-09-14', regra_versao: 'MATCH_V1',
    input_import_ids: [IDS.estoqueD1, IDS.aquisicoes, IDS.liquidacoes], assinatura_execucao: 'hash', status: 'CONCLUIDA',
    total_registros: 3, matched: 3, ambiguos: 0, nao_conciliados: 0, conflitos: 0,
    valor_total: '300', valor_matched: '300', valor_ambiguo: '0', valor_nao_conciliado: '0', detalhes: {},
    iniciado_em: '2026-09-15T10:00:00Z', finalizado_em: '2026-09-15T10:01:00Z', correlation_id: 'correlation',
    criado_por: null, created_at: '2026-09-15T10:00:00Z', ...overrides,
  }
}

function conciliacao(overrides: Partial<ConciliacaoExecucao> = {}): ConciliacaoExecucao {
  return {
    id: IDS.conciliacao, fundo_id: 'fundo', data_referencia: '2026-09-14', regra_versao: 'RECON_V1',
    estoque_d2_importacao_id: IDS.estoqueD2, estoque_d1_importacao_id: IDS.estoqueD1,
    aquisicoes_d1_importacao_id: IDS.aquisicoes, liquidacoes_d1_importacao_id: IDS.liquidacoes,
    matching_execucao_id: IDS.matching, assinatura_execucao: 'hash', status: 'CONCLUIDA', contagens: { MANTIDO_CORRETO: 3 },
    valores_agregados: {}, detalhes: {}, iniciado_em: '2026-09-15T10:01:00Z', finalizado_em: '2026-09-15T10:02:00Z',
    correlation_id: 'correlation', criado_por: null, created_at: '2026-09-15T10:01:00Z', ...overrides,
  }
}

function logistica(overrides: Partial<PosicaoLogisticaExecucao> = {}): PosicaoLogisticaExecucao {
  return {
    id: IDS.logistica, fundo_id: 'fundo', data_referencia: '2026-09-14', estoque_importacao_id: IDS.estoqueD1,
    matching_execucao_id: IDS.matching, regra_versao: 'RLX_LOGISTICA_V1', logistica_as_of: '2026-09-15T10:03:00Z',
    fingerprint_logistico: 'fingerprint', assinatura_execucao: 'hash', status: 'CONCLUIDA', total_posicoes: 3,
    posicoes_matched: 3, posicoes_sem_match: 0, posicoes_entregues: 1, posicoes_em_transito: 2,
    posicoes_indeterminadas: 0, posicoes_valor_ausente: 0, valor_total_aquisicao: '300', valor_matched: '300',
    valor_sem_match: '0', valor_entregue: '100', valor_em_transito: '200', valor_indeterminado: '0', detalhes: {},
    correlation_id: 'correlation', criado_por: null, iniciado_em: '2026-09-15T10:02:00Z', finalizado_em: '2026-09-15T10:03:00Z',
    created_at: '2026-09-15T10:02:00Z', ...overrides,
  }
}

function exposicao(overrides: Partial<ExposicaoExecucao> = {}): ExposicaoExecucao {
  return {
    id: IDS.exposicao, fundo_id: 'fundo', data_operacional: '2026-09-15', data_referencia_estoque: '2026-09-14',
    data_referencia_pl: '2026-09-11', posicao_logistica_execucao_id: IDS.logistica, carteira_importacao_id: IDS.pl,
    carteira_snapshot_id: 'snapshot', politica_operacional_versao_id: IDS.politica, logistica_as_of: '2026-09-15T10:03:00Z',
    overlay_as_of: '2026-09-15T10:04:00Z', regra_versao: 'RLX_EXPOSICAO_V1', limite_referencia_pct: '20', assinatura_execucao: 'hash',
    status: 'CALCULADA', quantidade_posicao: 3, quantidade_entregue: 1, quantidade_em_transito_estoque: 2,
    quantidade_indeterminada: 0, quantidade_sem_match: 0, quantidade_valor_aquisicao_ausente: 0, quantidade_overlay: 0,
    quantidade_ja_incorporada: 0, quantidade_nao_incorporada: 0, valor_posicao_total: '300', valor_entregue: '100',
    valor_em_transito_estoque: '200', valor_indeterminado: '0', valor_sem_match: '0', overlay_total: '0',
    overlay_em_transito: '0', overlay_entregue: '0', overlay_indeterminado: '0', operacoes_ja_incorporadas_valor: '0',
    operacoes_nao_incorporadas_valor: '0', exposicao_em_transito_total: '200', patrimonio_liquido_d2: '1000',
    percentual_exposicao: '20', classificacao_limite: 'NO_LIMITE', flags_qualidade: [], detalhes: {}, correlation_id: 'correlation',
    criado_por: null, iniciado_em: '2026-09-15T10:03:00Z', finalizado_em: '2026-09-15T10:04:00Z', created_at: '2026-09-15T10:03:00Z',
    ...overrides,
  }
}

function risco(overrides: Partial<RiscoExecucao> = {}): RiscoExecucao {
  return {
    id: IDS.risco, fundo_id: 'fundo', operacao_id: null, escopo: 'FUNDO', origem: 'CENTRAL_RISCO', regra_versao: 'GATE_RISCO_V1',
    politica_operacional_versao_id: IDS.politica, exposicao_execucao_id: IDS.exposicao, data_operacional: '2026-09-15',
    logistica_as_of: '2026-09-15T10:03:00Z', overlay_as_of: '2026-09-15T10:04:00Z', operacao_updated_at_snapshot: null,
    taxa_desconto_snapshot: null, aplicavel: true, status_tecnico: 'CONCLUIDA', decisao: 'APTO', limite_pct: '20', limite_inclusivo: true,
    patrimonio_liquido_d2: '1000', exposicao_atual_valor: '200', exposicao_atual_pct: '20', operacao_valor_aquisicao: null,
    operacao_valor_em_transito: null, operacao_valor_indeterminado: null, exposicao_projetada_valor: null, exposicao_projetada_pct: null,
    quantidade_indeterminada: 0, quantidade_sem_match: 0, quantidade_valor_aquisicao_ausente: 0,
    quantidade_operacao_nao_incorporada: 0, liquidacao_parcial_presente: false, assinatura_inputs: 'hash', detalhes: {},
    correlation_id: 'correlation', criado_por: null, iniciado_em: '2026-09-15T10:04:00Z', finalizado_em: '2026-09-15T10:05:00Z',
    created_at: '2026-09-15T10:04:00Z', ...overrides,
  }
}

function input(overrides: Partial<ResolverStatusEsteiraFinanceiraInput> = {}): ResolverStatusEsteiraFinanceiraInput {
  return {
    base: baseCompleta(), politica: politicaAplicavel, fundoVirgem: false, erros: {},
    execucoes: { matching: null, conciliacao: null, logistica: null, exposicao: null, risco: null },
    execucoesAnteriores: { matching: null, conciliacao: null, logistica: null, exposicao: null, risco: null },
    ...overrides,
  }
}

const status = (result: ReturnType<typeof resolverStatusEsteiraFinanceira>, id: string) => result.etapas.find((stage) => stage.id === id)!

describe('resolver server-side da esteira financeira', () => {
  it('reconhece todas as bases presentes sem transformar valores em regra financeira no client', () => {
    expect(status(resolverStatusEsteiraFinanceira(input()), 'bases').status).toBe('EXECUTADA')
  })

  it('bloqueia somente a conciliacao quando Estoque D-2 esta ausente', () => {
    const base = baseCompleta(); base.estoqueD2 = baseItem('ESTOQUE', IDS.estoqueD2, 'INDISPONIVEL')
    const result = resolverStatusEsteiraFinanceira(input({ base }))
    expect(status(result, 'matching').status).toBe('PRONTA')
    expect(status(result, 'conciliacao')).toMatchObject({ status: 'BLOQUEADA', motivo: expect.stringContaining('Estoque D-2') })
  })

  it('explica Aquisições D-1 ausentes', () => {
    const base = baseCompleta(); base.aquisicoes = baseItem('AQUISICOES', IDS.aquisicoes, 'INDISPONIVEL')
    expect(status(resolverStatusEsteiraFinanceira(input({ base })), 'conciliacao')).toMatchObject({ status: 'BLOQUEADA', motivo: expect.stringContaining('Aquisições D-1') })
  })

  it('preserva sem movimento valido como estado diferente de indisponibilidade', () => {
    const base = baseCompleta()
    base.estoqueD2 = baseItem('ESTOQUE', IDS.estoqueD2, 'SEM_MOVIMENTO')
    base.estoque = baseItem('ESTOQUE', IDS.estoqueD1, 'SEM_MOVIMENTO')
    base.aquisicoes = baseItem('AQUISICOES', IDS.aquisicoes, 'SEM_MOVIMENTO')
    base.liquidacoes = baseItem('LIQUIDACOES', IDS.liquidacoes, 'SEM_MOVIMENTO')
    expect(status(resolverStatusEsteiraFinanceira(input({ base })), 'bases').status).toBe('EXECUTADA_SEM_MOVIMENTO')
  })

  it('deixa Matching pronto sem exigir Conciliação', () => {
    expect(status(resolverStatusEsteiraFinanceira(input()), 'matching')).toMatchObject({ status: 'PRONTA', acao: { habilitada: true } })
  })

  it('reconhece Matching concluido com universo zero como execucao valida', () => {
    const base = baseCompleta()
    base.estoque = baseItem('ESTOQUE', IDS.estoqueD1, 'INDISPONIVEL')
    base.aquisicoes = baseItem('AQUISICOES', IDS.aquisicoes, 'INDISPONIVEL')
    base.liquidacoes = baseItem('LIQUIDACOES', IDS.liquidacoes, 'INDISPONIVEL')
    const result = resolverStatusEsteiraFinanceira(input({ base, fundoVirgem: true, execucoes: { ...input().execucoes, matching: matching({ input_import_ids: [], total_registros: 0, matched: 0 }) } }))
    expect(status(result, 'matching').status).toBe('EXECUTADA_SEM_MOVIMENTO')
  })

  it('classifica execucao de conciliacao com base incompleta como bloqueada', () => {
    const base = baseCompleta(); base.liquidacoes = baseItem('LIQUIDACOES', IDS.liquidacoes, 'INDISPONIVEL')
    const execution = conciliacao({ status: 'BASE_INCOMPLETA', liquidacoes_d1_importacao_id: null, contagens: { BASE_INCOMPLETA: 1 } })
    expect(status(resolverStatusEsteiraFinanceira(input({ base, execucoes: { ...input().execucoes, conciliacao: execution } })), 'conciliacao').status).toBe('BLOQUEADA')
  })

  it('bloqueia Logistica sem Matching compativel', () => {
    expect(status(resolverStatusEsteiraFinanceira(input()), 'logistica')).toMatchObject({ status: 'BLOQUEADA', motivo: expect.stringContaining('Vínculo Título × NF') })
  })

  it('marca Logistica como nao aplicavel pela politica', () => {
    const politica = { ...politicaAplicavel, criaAcompanhamentoEntrega: false }
    expect(status(resolverStatusEsteiraFinanceira(input({ politica })), 'logistica')).toMatchObject({ aplicavel: false, status: 'NAO_APLICAVEL', acao: null })
  })

  it('bloqueia Exposicao sem PL sem exigir Conciliação', () => {
    const base = baseCompleta(); base.carteira = baseItem('CARTEIRA', IDS.pl, 'INDISPONIVEL')
    const executions = { ...input().execucoes, matching: matching(), logistica: logistica() }
    expect(status(resolverStatusEsteiraFinanceira(input({ base, execucoes: executions })), 'exposicao')).toMatchObject({ status: 'BLOQUEADA', motivo: expect.stringContaining('PL de referência') })
  })

  it('marca Exposicao como nao aplicavel sem controle financeiro', () => {
    const politica = { ...politicaAplicavel, controleExposicaoAtivo: false, gateRiscoAtivo: false }
    expect(status(resolverStatusEsteiraFinanceira(input({ politica })), 'exposicao').status).toBe('NAO_APLICAVEL')
  })

  it('marca Risco como nao aplicavel sem gate ativo', () => {
    const politica = { ...politicaAplicavel, gateRiscoAtivo: false }
    expect(status(resolverStatusEsteiraFinanceira(input({ politica })), 'risco').status).toBe('NAO_APLICAVEL')
  })

  it('mantem execucao incompativel apenas como historico', () => {
    const stale = matching({ input_import_ids: ['base-substituida'] })
    const result = resolverStatusEsteiraFinanceira(input({ execucoes: { ...input().execucoes, matching: stale } }))
    expect(status(result, 'matching')).toMatchObject({ status: 'PRONTA', ultimaExecucao: { historica: true } })
  })

  it('explicita erro de execucao sem mascarar como pendencia', () => {
    const result = resolverStatusEsteiraFinanceira(input({ execucoes: { ...input().execucoes, matching: matching({ status: 'FALHA' }) } }))
    expect(status(result, 'matching')).toMatchObject({ status: 'ERRO', acao: { habilitada: true } })
  })

  it('trata fundo virgem sem historico como aguardando primeira publicacao, nao erro', () => {
    const base = baseCompleta()
    base.estoqueD2 = baseItem('ESTOQUE', IDS.estoqueD2, 'INDISPONIVEL')
    base.estoque = baseItem('ESTOQUE', IDS.estoqueD1, 'INDISPONIVEL')
    base.aquisicoes = baseItem('AQUISICOES', IDS.aquisicoes, 'INDISPONIVEL')
    base.liquidacoes = baseItem('LIQUIDACOES', IDS.liquidacoes, 'INDISPONIVEL')
    base.carteira = baseItem('CARTEIRA', IDS.pl, 'INDISPONIVEL')
    const result = resolverStatusEsteiraFinanceira(input({ base, fundoVirgem: true }))
    expect(status(result, 'bases')).toMatchObject({ status: 'PENDENTE', motivo: expect.stringContaining('primeira publicação') })
    expect(status(result, 'matching').status).toBe('PRONTA')
    expect(status(result, 'conciliacao').status).toBe('PRONTA')
  })

  it('mantem cadeia pronta no grafo real sem depender de Conciliação', () => {
    const executions = { ...input().execucoes, matching: matching(), logistica: logistica() }
    const result = resolverStatusEsteiraFinanceira(input({ execucoes: executions }))
    expect(status(result, 'exposicao').status).toBe('PRONTA')
    expect(status(result, 'risco').status).toBe('PRONTA')
    expect(result.proximaAcao.mensagem).toContain('recompõe automaticamente')
  })

  it('reconhece cadeia concluida e nao sugere etapa N/A', () => {
    const executions = { matching: matching(), conciliacao: conciliacao(), logistica: logistica(), exposicao: exposicao(), risco: risco() }
    const result = resolverStatusEsteiraFinanceira(input({ execucoes: executions }))
    expect(result.etapas.filter((stage) => stage.aplicavel).every((stage) => ['EXECUTADA', 'EXECUTADA_SEM_MOVIMENTO'].includes(stage.status))).toBe(true)
    expect(result.proximaAcao).toEqual({ etapaId: null, mensagem: 'Fluxo operacional da data concluído.' })
  })
})

describe('cenarios E2E do cockpit P7.3', () => {
  it('cenario A: base incompleta apresenta bloqueio correto', () => {
    const base = baseCompleta(); base.estoqueD2 = baseItem('ESTOQUE', IDS.estoqueD2, 'INDISPONIVEL')
    const result = resolverStatusEsteiraFinanceira(input({ base }))
    expect(status(result, 'conciliacao')).toMatchObject({ status: 'BLOQUEADA', motivo: expect.stringContaining('Estoque D-2') })
  })

  it('cenario B: bases completas deixam Matching e Conciliacao prontos', () => {
    const result = resolverStatusEsteiraFinanceira(input())
    expect(status(result, 'matching').status).toBe('PRONTA')
    expect(status(result, 'conciliacao').status).toBe('PRONTA')
  })

  it('cenario C: fluxo completo mantem todas as etapas coerentes', () => {
    const execucoes = { matching: matching(), conciliacao: conciliacao(), logistica: logistica(), exposicao: exposicao(), risco: risco() }
    const result = resolverStatusEsteiraFinanceira(input({ execucoes }))
    expect(result.etapas.map((stage) => stage.status)).toEqual(['EXECUTADA', 'EXECUTADA', 'EXECUTADA', 'EXECUTADA', 'EXECUTADA', 'EXECUTADA'])
  })

  it('cenario D: politica sem controles opcionais marca Logistica, Exposicao e Risco como N/A', () => {
    const politica = { ...politicaAplicavel, criaAcompanhamentoEntrega: false, controleExposicaoAtivo: false, gateRiscoAtivo: false }
    const result = resolverStatusEsteiraFinanceira(input({ politica }))
    expect(['logistica', 'exposicao', 'risco'].map((id) => status(result, id).status)).toEqual(['NAO_APLICAVEL', 'NAO_APLICAVEL', 'NAO_APLICAVEL'])
  })
})
