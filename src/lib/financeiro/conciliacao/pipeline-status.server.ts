import 'server-only'

import type {
  ConciliacaoExecucao,
  ExposicaoExecucao,
  MatchingExecucao,
  PosicaoLogisticaExecucao,
  RiscoExecucao,
} from '@/types/database'
import type { BaseFinanceiraDaData, BaseFinanceiraResolvida } from './base-financeira'
import type { ConciliacaoBlock, PoliticaFinanceiraDaData } from './loaders.server'
import { totalDeContagens } from './execution-state'

export type EtapaEsteiraFinanceiraId = 'bases' | 'matching' | 'conciliacao' | 'logistica' | 'exposicao' | 'risco'
export type StatusEtapaEsteiraFinanceira =
  | 'PRONTA'
  | 'EXECUTADA'
  | 'EXECUTADA_SEM_MOVIMENTO'
  | 'BLOQUEADA'
  | 'PENDENTE'
  | 'ERRO'
  | 'NAO_APLICAVEL'

export type AcaoEsteiraFinanceiraId = 'matching' | 'conciliacao' | 'logistica' | 'exposicao' | 'risco'

export type AcaoEsteiraFinanceira = {
  id: AcaoEsteiraFinanceiraId
  label: string
  habilitada: boolean
}

export type UltimaExecucaoEsteira = {
  dataReferencia: string
  executadaEm: string | null
  historica: boolean
}

export type EtapaEsteiraFinanceira = {
  id: EtapaEsteiraFinanceiraId
  titulo: string
  aplicavel: boolean
  status: StatusEtapaEsteiraFinanceira
  dataReferencia: string
  ultimaExecucao: UltimaExecucaoEsteira | null
  motivo: string
  acao: AcaoEsteiraFinanceira | null
}

export type StatusEsteiraFinanceira = {
  dataOperacional: string
  dataD1: string
  dataD2: string
  fundoVirgem: boolean
  etapas: EtapaEsteiraFinanceira[]
  proximaAcao: {
    etapaId: EtapaEsteiraFinanceiraId | null
    mensagem: string
  }
}

type ExecucoesEsteira = {
  matching: MatchingExecucao | null
  conciliacao: ConciliacaoExecucao | null
  logistica: PosicaoLogisticaExecucao | null
  exposicao: ExposicaoExecucao | null
  risco: RiscoExecucao | null
}

type ExecucaoTemporal = {
  data_operacional?: string
  data_referencia?: string
  finalizado_em?: string | null
  created_at?: string
  iniciado_em?: string
}

export type ResolverStatusEsteiraFinanceiraInput = {
  base: BaseFinanceiraDaData
  politica: PoliticaFinanceiraDaData
  execucoes: ExecucoesEsteira
  execucoesAnteriores: ExecucoesEsteira
  exposicaoIncompativel?: ExposicaoExecucao | null
  erros?: Partial<Record<ConciliacaoBlock, string>>
  fundoVirgem: boolean
}

const ACTIONS: Record<AcaoEsteiraFinanceiraId, string> = {
  matching: 'Executar vínculo',
  conciliacao: 'Executar conciliação',
  logistica: 'Atualizar logística',
  exposicao: 'Calcular exposição',
  risco: 'Atualizar risco',
}

const BASES_CONCILIACAO: Array<{ key: keyof Pick<BaseFinanceiraDaData, 'estoqueD2' | 'estoque' | 'aquisicoes' | 'liquidacoes'>; label: string }> = [
  { key: 'estoqueD2', label: 'Estoque D-2' },
  { key: 'estoque', label: 'Estoque D-1' },
  { key: 'aquisicoes', label: 'Aquisições D-1' },
  { key: 'liquidacoes', label: 'Liquidações D-1' },
]

const BASES_FINANCEIRAS: Array<{ key: keyof Pick<BaseFinanceiraDaData, 'estoqueD2' | 'estoque' | 'aquisicoes' | 'liquidacoes' | 'carteira'>; label: string }> = [
  ...BASES_CONCILIACAO,
  { key: 'carteira', label: 'PL de referência' },
]

function acao(id: AcaoEsteiraFinanceiraId, habilitada: boolean): AcaoEsteiraFinanceira {
  return { id, label: ACTIONS[id], habilitada }
}

function idsIguais(actual: Array<string | null | undefined>, expected: Array<string | null | undefined>) {
  const normalize = (values: Array<string | null | undefined>) => values.filter((value): value is string => Boolean(value)).sort()
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected))
}

function baseDisponivel(base: BaseFinanceiraResolvida) {
  return base.estado !== 'INDISPONIVEL'
}

function semMovimento(base: BaseFinanceiraResolvida) {
  return base.estado === 'SEM_MOVIMENTO'
}

function formatarLista(itens: string[]) {
  if (itens.length <= 1) return itens[0] || ''
  return `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`
}

function dataHoraExecucao(execution: ExecucaoTemporal) {
  const value = execution.finalizado_em || execution.created_at || execution.iniciado_em
  return value ? String(value) : null
}

function referenciaExecucao(execution: ExecucaoTemporal, fallback: string) {
  return String(execution.data_operacional || execution.data_referencia || fallback)
}

function ultimaExecucao(
  atual: ExecucaoTemporal | null,
  atualCompativel: boolean,
  anterior: ExecucaoTemporal | null,
  fallback: string,
): UltimaExecucaoEsteira | null {
  const execution = atual || anterior
  if (!execution) return null
  return {
    dataReferencia: referenciaExecucao(execution, fallback),
    executadaEm: dataHoraExecucao(execution),
    historica: !atual || !atualCompativel,
  }
}

function etapaNaoAplicavel(id: EtapaEsteiraFinanceiraId, titulo: string, dataReferencia: string, motivo: string): EtapaEsteiraFinanceira {
  return { id, titulo, aplicavel: false, status: 'NAO_APLICAVEL', dataReferencia, ultimaExecucao: null, motivo, acao: null }
}

function resolverBases(input: ResolverStatusEsteiraFinanceiraInput): EtapaEsteiraFinanceira {
  const bases = BASES_CONCILIACAO.map(({ key }) => input.base[key])
  const ausentes = BASES_FINANCEIRAS.filter(({ key }) => !baseDisponivel(input.base[key])).map(({ label }) => label)
  if (input.erros?.base) {
    return {
      id: 'bases', titulo: 'Bases financeiras', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataOperacional,
      ultimaExecucao: null, motivo: input.erros.base, acao: null,
    }
  }
  if (ausentes.length === BASES_FINANCEIRAS.length && input.fundoVirgem) {
    return {
      id: 'bases', titulo: 'Bases financeiras', aplicavel: true, status: 'PENDENTE', dataReferencia: input.base.dataOperacional,
      ultimaExecucao: null, motivo: 'Fundo sem histórico financeiro. Aguardando a primeira publicação de bases e PL.', acao: null,
    }
  }
  if (ausentes.length > 0) {
    return {
      id: 'bases', titulo: 'Bases financeiras', aplicavel: true, status: 'PENDENTE', dataReferencia: input.base.dataOperacional,
      ultimaExecucao: null, motivo: `${formatarLista(ausentes)} ${ausentes.length === 1 ? 'ainda não está disponível' : 'ainda não estão disponíveis'}.`, acao: null,
    }
  }
  if (bases.every(semMovimento)) {
    return {
      id: 'bases', titulo: 'Bases financeiras', aplicavel: true, status: 'EXECUTADA_SEM_MOVIMENTO', dataReferencia: input.base.dataOperacional,
      ultimaExecucao: null, motivo: 'As quatro bases foram publicadas com declaração válida de ausência de movimento.', acao: null,
    }
  }
  return {
    id: 'bases', titulo: 'Bases financeiras', aplicavel: true, status: 'EXECUTADA', dataReferencia: input.base.dataOperacional,
    ultimaExecucao: null, motivo: 'Bases publicadas para a data operacional selecionada.', acao: null,
  }
}

function matchingCompativel(execution: MatchingExecucao | null, input: ResolverStatusEsteiraFinanceiraInput) {
  if (!execution || execution.data_referencia !== input.base.dataD1) return false
  const expected = [input.base.estoque.importacaoId, input.base.aquisicoes.importacaoId, input.base.liquidacoes.importacaoId]
  if (input.fundoVirgem && expected.every((id) => !id)) return execution.input_import_ids.length === 0
  return idsIguais(execution.input_import_ids, expected)
}

function resolverMatching(input: ResolverStatusEsteiraFinanceiraInput): EtapaEsteiraFinanceira {
  const execution = input.execucoes.matching
  const compatible = matchingCompativel(execution, input)
  const history = ultimaExecucao(execution, compatible, input.execucoesAnteriores.matching, input.base.dataD1)
  const action = acao('matching', !input.erros?.matching)
  if (input.erros?.matching) return { id: 'matching', titulo: 'Vínculo Título × NF', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: input.erros.matching, acao: { ...action, habilitada: false } }
  if (execution?.status === 'FALHA' && compatible) return { id: 'matching', titulo: 'Vínculo Título × NF', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: 'A execução da data terminou com erro e pode ser tentada novamente.', acao: action }
  if (execution?.status === 'PROCESSANDO' && compatible) return { id: 'matching', titulo: 'Vínculo Título × NF', aplicavel: true, status: 'PENDENTE', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: 'A execução da data ainda está em processamento.', acao: { ...action, habilitada: false } }
  if (execution?.status === 'CONCLUIDA' && compatible) {
    const empty = execution.total_registros === 0
    return { id: 'matching', titulo: 'Vínculo Título × NF', aplicavel: true, status: empty ? 'EXECUTADA_SEM_MOVIMENTO' : 'EXECUTADA', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: empty ? 'Execução concluída com universo financeiro validamente vazio.' : `Execução concluída com ${execution.matched} de ${execution.total_registros} títulos vinculados.`, acao: action }
  }
  const hasInput = [input.base.estoque, input.base.aquisicoes, input.base.liquidacoes].some(baseDisponivel)
  if (!hasInput && !input.fundoVirgem) return { id: 'matching', titulo: 'Vínculo Título × NF', aplicavel: true, status: 'BLOQUEADA', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: 'Nenhuma base financeira D-1 foi publicada para executar o vínculo.', acao: { ...action, habilitada: false } }
  return { id: 'matching', titulo: 'Vínculo Título × NF', aplicavel: true, status: 'PRONTA', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: compatible ? 'O vínculo pode ser reprocessado para a data.' : execution ? 'A execução encontrada usa bases substituídas e permanece apenas no histórico.' : input.fundoVirgem && !hasInput ? 'Fundo virgem apto a registrar uma execução válida sem movimento.' : 'Há base D-1 disponível para executar o vínculo.', acao: action }
}

function conciliacaoCompativel(execution: ConciliacaoExecucao | null, base: BaseFinanceiraDaData) {
  return Boolean(execution
    && execution.data_referencia === base.dataD1
    && idsIguais(
      [execution.estoque_d2_importacao_id, execution.estoque_d1_importacao_id, execution.aquisicoes_d1_importacao_id, execution.liquidacoes_d1_importacao_id],
      [base.estoqueD2.importacaoId, base.estoque.importacaoId, base.aquisicoes.importacaoId, base.liquidacoes.importacaoId],
    ))
}

function resolverConciliacao(input: ResolverStatusEsteiraFinanceiraInput): EtapaEsteiraFinanceira {
  const execution = input.execucoes.conciliacao
  const compatible = conciliacaoCompativel(execution, input.base)
  const history = ultimaExecucao(execution, compatible, input.execucoesAnteriores.conciliacao, input.base.dataD1)
  const action = acao('conciliacao', !input.erros?.conciliacao)
  if (input.erros?.conciliacao) return { id: 'conciliacao', titulo: 'Conciliação Financeira', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: input.erros.conciliacao, acao: { ...action, habilitada: false } }
  if (execution?.status === 'FALHA' && compatible) return { id: 'conciliacao', titulo: 'Conciliação Financeira', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: 'A execução da data terminou com erro e pode ser tentada novamente.', acao: action }
  if (execution?.status === 'PROCESSANDO' && compatible) return { id: 'conciliacao', titulo: 'Conciliação Financeira', aplicavel: true, status: 'PENDENTE', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: 'A execução da data ainda está em processamento.', acao: { ...action, habilitada: false } }
  if (execution?.status === 'CONCLUIDA' && compatible) {
    const empty = totalDeContagens(execution.contagens) === 0
    return { id: 'conciliacao', titulo: 'Conciliação Financeira', aplicavel: true, status: empty ? 'EXECUTADA_SEM_MOVIMENTO' : 'EXECUTADA', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: empty ? 'Conciliação concluída sem movimento para a data.' : 'Conciliação operacional concluída para as bases atuais.', acao: action }
  }
  const missing = BASES_CONCILIACAO.filter(({ key }) => !baseDisponivel(input.base[key])).map(({ label }) => label)
  if (execution?.status === 'BASE_INCOMPLETA' && compatible || missing.length > 0 && !(input.fundoVirgem && missing.length === BASES_CONCILIACAO.length)) {
    return { id: 'conciliacao', titulo: 'Conciliação Financeira', aplicavel: true, status: 'BLOQUEADA', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: `${formatarLista(missing)} ${missing.length === 1 ? 'precisa ser publicada' : 'precisam ser publicadas'} para concluir a conciliação.`, acao: { ...action, habilitada: false } }
  }
  return { id: 'conciliacao', titulo: 'Conciliação Financeira', aplicavel: true, status: 'PRONTA', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: execution && !compatible ? 'A execução encontrada usa bases substituídas e permanece apenas no histórico.' : input.fundoVirgem ? 'Fundo virgem apto a registrar conciliação válida sem movimento.' : 'As quatro bases necessárias estão disponíveis.', acao: action }
}

function logisticaCompativel(execution: PosicaoLogisticaExecucao | null, input: ResolverStatusEsteiraFinanceiraInput, matchingOk: boolean) {
  if (!execution || execution.data_referencia !== input.base.dataD1 || !matchingOk) return false
  if (input.fundoVirgem && !input.base.estoque.importacaoId) return !execution.estoque_importacao_id && !execution.matching_execucao_id
  return execution.estoque_importacao_id === input.base.estoque.importacaoId
    && execution.matching_execucao_id === input.execucoes.matching?.id
}

function resolverLogistica(input: ResolverStatusEsteiraFinanceiraInput, matching: EtapaEsteiraFinanceira): EtapaEsteiraFinanceira {
  if (input.erros?.politica) return { id: 'logistica', titulo: 'Posição Logística', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataD1, ultimaExecucao: null, motivo: input.erros.politica, acao: { ...acao('logistica', false) } }
  if (input.politica.estado !== 'APLICAVEL' || !input.politica.criaAcompanhamentoEntrega) {
    return etapaNaoAplicavel('logistica', 'Posição Logística', input.base.dataD1, 'A política vigente não habilita acompanhamento logístico.')
  }
  const execution = input.execucoes.logistica
  const matchingOk = ['EXECUTADA', 'EXECUTADA_SEM_MOVIMENTO'].includes(matching.status)
  const compatible = logisticaCompativel(execution, input, matchingOk)
  const history = ultimaExecucao(execution, compatible, input.execucoesAnteriores.logistica, input.base.dataD1)
  const action = acao('logistica', !input.erros?.logistica)
  if (input.erros?.logistica) return { id: 'logistica', titulo: 'Posição Logística', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: input.erros.logistica, acao: { ...action, habilitada: false } }
  if (execution?.status === 'FALHA' && compatible) return { id: 'logistica', titulo: 'Posição Logística', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: 'A execução logística da data terminou com erro.', acao: action }
  if (execution?.status === 'PROCESSANDO' && compatible) return { id: 'logistica', titulo: 'Posição Logística', aplicavel: true, status: 'PENDENTE', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: 'A posição logística ainda está em processamento.', acao: { ...action, habilitada: false } }
  if (execution?.status === 'CONCLUIDA' && compatible) {
    const empty = execution.total_posicoes === 0
    return { id: 'logistica', titulo: 'Posição Logística', aplicavel: true, status: empty ? 'EXECUTADA_SEM_MOVIMENTO' : 'EXECUTADA', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: empty ? 'Posição concluída sem títulos no estoque.' : `Posição concluída para ${execution.total_posicoes} títulos do estoque.`, acao: action }
  }
  if (!baseDisponivel(input.base.estoque) && !input.fundoVirgem) return { id: 'logistica', titulo: 'Posição Logística', aplicavel: true, status: 'BLOQUEADA', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: 'Estoque D-1 ainda não foi publicado.', acao: { ...action, habilitada: false } }
  if (!matchingOk) return { id: 'logistica', titulo: 'Posição Logística', aplicavel: true, status: 'BLOQUEADA', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: 'Execute um Vínculo Título × NF compatível com o Estoque D-1 atual.', acao: { ...action, habilitada: false } }
  return { id: 'logistica', titulo: 'Posição Logística', aplicavel: true, status: 'PRONTA', dataReferencia: input.base.dataD1, ultimaExecucao: history, motivo: execution && !compatible ? 'A posição anterior usa bases substituídas e permanece apenas no histórico.' : 'Estoque D-1 e vínculo compatível estão disponíveis.', acao: action }
}

function exposicaoCompativel(execution: ExposicaoExecucao | null, input: ResolverStatusEsteiraFinanceiraInput, logisticaOk: boolean) {
  return Boolean(execution
    && logisticaOk
    && execution.data_operacional === input.base.dataOperacional
    && execution.data_referencia_estoque === input.base.dataD1
    && execution.data_referencia_pl === input.base.carteira.dataReferencia
    && execution.posicao_logistica_execucao_id === input.execucoes.logistica?.id
    && execution.politica_operacional_versao_id === input.politica.versaoId)
}

function resolverExposicao(input: ResolverStatusEsteiraFinanceiraInput, logistica: EtapaEsteiraFinanceira): EtapaEsteiraFinanceira {
  if (input.erros?.politica) return { id: 'exposicao', titulo: 'Exposição em Trânsito', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataOperacional, ultimaExecucao: null, motivo: input.erros.politica, acao: { ...acao('exposicao', false) } }
  if (input.politica.estado !== 'APLICAVEL' || !input.politica.controleExposicaoAtivo) {
    return etapaNaoAplicavel('exposicao', 'Exposição em Trânsito', input.base.dataOperacional, 'O controle de exposição logística não está ativo na política vigente.')
  }
  const execution = input.execucoes.exposicao
  const logisticaOk = ['EXECUTADA', 'EXECUTADA_SEM_MOVIMENTO'].includes(logistica.status)
  const compatible = exposicaoCompativel(execution, input, logisticaOk)
  const incompatible = input.exposicaoIncompativel || null
  const history = ultimaExecucao(execution || incompatible, compatible, input.execucoesAnteriores.exposicao, input.base.dataOperacional)
  const action = acao('exposicao', !input.erros?.exposicao)
  if (input.erros?.exposicao) return { id: 'exposicao', titulo: 'Exposição em Trânsito', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataOperacional, ultimaExecucao: history, motivo: input.erros.exposicao, acao: { ...action, habilitada: false } }
  if (execution?.status === 'CALCULADA' && compatible) return { id: 'exposicao', titulo: 'Exposição em Trânsito', aplicavel: true, status: 'EXECUTADA', dataReferencia: input.base.dataOperacional, ultimaExecucao: history, motivo: 'Exposição calculada com a posição logística, o PL e a política vigentes.', acao: action }
  if (execution && compatible && ['PL_D2_INDISPONIVEL', 'PL_D2_INVALIDO', 'PL_OFICIAL_INDISPONIVEL', 'POSICAO_LOGISTICA_INDISPONIVEL', 'BASE_INCOMPATIVEL'].includes(execution.status)) {
    return { id: 'exposicao', titulo: 'Exposição em Trânsito', aplicavel: true, status: 'BLOQUEADA', dataReferencia: input.base.dataOperacional, ultimaExecucao: history, motivo: 'A última tentativa registrou base, posição logística ou PL indisponível.', acao: { ...action, habilitada: false } }
  }
  if (!logisticaOk) return { id: 'exposicao', titulo: 'Exposição em Trânsito', aplicavel: true, status: 'BLOQUEADA', dataReferencia: input.base.dataOperacional, ultimaExecucao: history, motivo: 'Atualize uma Posição Logística válida para a data antes de calcular a exposição.', acao: { ...action, habilitada: false } }
  if (!baseDisponivel(input.base.carteira)) return { id: 'exposicao', titulo: 'Exposição em Trânsito', aplicavel: true, status: 'BLOQUEADA', dataReferencia: input.base.dataOperacional, ultimaExecucao: history, motivo: input.fundoVirgem ? 'O primeiro PL oficial ainda não foi publicado.' : 'O PL de referência ainda não está disponível.', acao: { ...action, habilitada: false } }
  return { id: 'exposicao', titulo: 'Exposição em Trânsito', aplicavel: true, status: 'PRONTA', dataReferencia: input.base.dataOperacional, ultimaExecucao: history, motivo: execution || incompatible ? 'A execução encontrada não corresponde à posição, ao PL ou à política atuais.' : 'Posição logística e PL de referência estão disponíveis.', acao: action }
}

function riscoCompativel(execution: RiscoExecucao | null, input: ResolverStatusEsteiraFinanceiraInput) {
  return Boolean(execution
    && execution.data_operacional === input.base.dataOperacional
    && execution.escopo === 'FUNDO'
    && execution.politica_operacional_versao_id === input.politica.versaoId)
}

function resolverRisco(input: ResolverStatusEsteiraFinanceiraInput): EtapaEsteiraFinanceira {
  if (input.erros?.politica) return { id: 'risco', titulo: 'Gate de Risco', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataOperacional, ultimaExecucao: null, motivo: input.erros.politica, acao: { ...acao('risco', false) } }
  if (input.politica.estado !== 'APLICAVEL' || !input.politica.gateRiscoAtivo) {
    return etapaNaoAplicavel('risco', 'Gate de Risco', input.base.dataOperacional, 'O Gate de Risco não está ativo na política vigente.')
  }
  const execution = input.execucoes.risco
  const compatible = riscoCompativel(execution, input)
  const history = ultimaExecucao(execution, compatible, input.execucoesAnteriores.risco, input.base.dataOperacional)
  const action = acao('risco', !input.erros?.risco)
  if (input.erros?.risco) return { id: 'risco', titulo: 'Gate de Risco', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataOperacional, ultimaExecucao: history, motivo: input.erros.risco, acao: { ...action, habilitada: false } }
  if (execution?.status_tecnico === 'AVALIACAO_RISCO_INDISPONIVEL' && compatible) return { id: 'risco', titulo: 'Gate de Risco', aplicavel: true, status: 'ERRO', dataReferencia: input.base.dataOperacional, ultimaExecucao: history, motivo: 'A avaliação da data registrou indisponibilidade técnica. A atualização pode ser tentada novamente.', acao: action }
  if (execution?.status_tecnico === 'CONCLUIDA' && compatible) return { id: 'risco', titulo: 'Gate de Risco', aplicavel: true, status: 'EXECUTADA', dataReferencia: input.base.dataOperacional, ultimaExecucao: history, motivo: `Avaliação concluída${execution.decisao ? ` com resultado ${execution.decisao}` : ''}.`, acao: action }
  return { id: 'risco', titulo: 'Gate de Risco', aplicavel: true, status: 'PRONTA', dataReferencia: input.base.dataOperacional, ultimaExecucao: history, motivo: execution && !compatible ? 'A avaliação encontrada usa outra política e permanece apenas no histórico. A atualização recompõe toda a cadeia canônica.' : 'Ao atualizar o Gate de Risco, a cadeia canônica de Matching, Conciliação, Logística e Exposição é reprocessada.', acao: action }
}

function recomendarProximaAcao(etapas: EtapaEsteiraFinanceira[]) {
  const risco = etapas.find((item) => item.id === 'risco')
  if (risco?.status === 'PRONTA' && risco.acao?.habilitada) {
    return { etapaId: risco.id, mensagem: 'Gate de Risco pode ser atualizado; o processamento recompõe automaticamente as etapas anteriores.' }
  }
  const ready = etapas.find((item) => item.status === 'PRONTA' && item.acao?.habilitada)
  if (ready) return { etapaId: ready.id, mensagem: `Próxima ação: ${ready.acao!.label.toLocaleLowerCase('pt-BR')}.` }
  const blocked = etapas.find((item) => item.status === 'BLOQUEADA')
  if (blocked) return { etapaId: blocked.id, mensagem: `${blocked.titulo} está bloqueada: ${blocked.motivo}` }
  const error = etapas.find((item) => item.status === 'ERRO')
  if (error) return { etapaId: error.id, mensagem: `${error.titulo} requer atenção: ${error.motivo}` }
  const pending = etapas.find((item) => item.status === 'PENDENTE')
  if (pending) return { etapaId: pending.id, mensagem: pending.motivo }
  return { etapaId: null, mensagem: 'Fluxo operacional da data concluído.' }
}

export function resolverStatusEsteiraFinanceira(input: ResolverStatusEsteiraFinanceiraInput): StatusEsteiraFinanceira {
  const bases = resolverBases(input)
  const matching = resolverMatching(input)
  const conciliacao = resolverConciliacao(input)
  const logistica = resolverLogistica(input, matching)
  const exposicao = resolverExposicao(input, logistica)
  const risco = resolverRisco(input)
  const etapas = [bases, matching, conciliacao, logistica, exposicao, risco]
  return {
    dataOperacional: input.base.dataOperacional,
    dataD1: input.base.dataD1,
    dataD2: input.base.dataD2,
    fundoVirgem: input.fundoVirgem,
    etapas,
    proximaAcao: recomendarProximaAcao(etapas),
  }
}
