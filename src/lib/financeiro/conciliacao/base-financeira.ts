import Decimal from 'decimal.js'
import { resolverExpectativasCicloFinanceiro } from '@/lib/financeiro/ingestao/cron-contract'
import type { ImportacaoFinanceira } from '@/types/database'

export type EstadoBaseFinanceira = 'VALOR' | 'ZERO' | 'SEM_MOVIMENTO' | 'DISPONIVEL' | 'INDISPONIVEL'
export type StatusGeralBaseFinanceira = 'PRONTA' | 'BASE_INCOMPLETA' | 'SEM_MOVIMENTO' | 'INDISPONIVEL'

export type ImportacaoResumoBase = Pick<ImportacaoFinanceira,
  'id' | 'tipo_base' | 'data_referencia' | 'completude' | 'declaracao_sem_movimento' |
  'origem' | 'provedor' | 'linhas_publicadas' | 'valor_total' | 'publicada_em'
>

export type SnapshotCarteiraResumo = {
  importacao_id: string
  patrimonio_liquido: string | number
  vigente: boolean
}

export type BaseFinanceiraResolvida = {
  tipo: ImportacaoFinanceira['tipo_base']
  dataEsperada: string
  estado: EstadoBaseFinanceira
  valor: string | null
  importacaoId: string | null
  origem: string | null
  provedor: string | null
  origemQa: boolean
}

export type BaseFinanceiraDaData = {
  dataOperacional: string
  dataD1: string
  dataD2: string
  estoque: BaseFinanceiraResolvida
  carteira: BaseFinanceiraResolvida
  aquisicoes: BaseFinanceiraResolvida
  liquidacoes: BaseFinanceiraResolvida
  statusGeral: StatusGeralBaseFinanceira
}

function origemEhQa(importacao: ImportacaoResumoBase) {
  return importacao.origem === 'GOLDEN_DATASET'
    || /(^|[_-])(qa|golden)([_-]|$)/i.test(importacao.provedor)
}

function latest(importacoes: ImportacaoResumoBase[], tipo: ImportacaoFinanceira['tipo_base'], data: string) {
  return importacoes
    .filter((item) => item.tipo_base === tipo && item.data_referencia === data)
    .sort((left, right) => String(right.publicada_em || '').localeCompare(String(left.publicada_em || '')))[0] || null
}

function indisponivel(tipo: ImportacaoFinanceira['tipo_base'], dataEsperada: string): BaseFinanceiraResolvida {
  return { tipo, dataEsperada, estado: 'INDISPONIVEL', valor: null, importacaoId: null, origem: null, provedor: null, origemQa: false }
}

function resolveBase(input: {
  importacoes: ImportacaoResumoBase[]
  snapshots: SnapshotCarteiraResumo[]
  tipo: ImportacaoFinanceira['tipo_base']
  dataEsperada: string
}): BaseFinanceiraResolvida {
  const importacao = latest(input.importacoes, input.tipo, input.dataEsperada)
  if (!importacao) return indisponivel(input.tipo, input.dataEsperada)

  const common = {
    tipo: input.tipo,
    dataEsperada: input.dataEsperada,
    importacaoId: importacao.id,
    origem: importacao.origem,
    provedor: importacao.provedor,
    origemQa: origemEhQa(importacao),
  }
  if (importacao.completude === 'COMPLETO_VAZIO' || importacao.declaracao_sem_movimento) {
    return { ...common, estado: 'SEM_MOVIMENTO', valor: null }
  }

  const rawValue = input.tipo === 'CARTEIRA'
    ? input.snapshots.find((item) => item.importacao_id === importacao.id && item.vigente)?.patrimonio_liquido
    : importacao.valor_total
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return input.tipo === 'CARTEIRA'
      ? indisponivel(input.tipo, input.dataEsperada)
      : { ...common, estado: 'DISPONIVEL', valor: null }
  }
  const value = new Decimal(String(rawValue))
  return { ...common, estado: value.isZero() ? 'ZERO' : 'VALOR', valor: value.toFixed(4) }
}

function statusGeral(bases: BaseFinanceiraResolvida[]): StatusGeralBaseFinanceira {
  if (bases.every((base) => base.estado === 'INDISPONIVEL')) return 'INDISPONIVEL'
  if (bases.some((base) => base.estado === 'INDISPONIVEL')) return 'BASE_INCOMPLETA'
  if (bases.every((base) => base.estado === 'SEM_MOVIMENTO')) return 'SEM_MOVIMENTO'
  return 'PRONTA'
}

export function montarBaseFinanceiraDaData(input: {
  dataOperacional: string
  importacoes: ImportacaoResumoBase[]
  snapshots: SnapshotCarteiraResumo[]
}): BaseFinanceiraDaData {
  const datas = resolverExpectativasCicloFinanceiro(input.dataOperacional)
  const estoque = resolveBase({ ...input, tipo: 'ESTOQUE', dataEsperada: datas.ESTOQUE })
  const carteira = resolveBase({ ...input, tipo: 'CARTEIRA', dataEsperada: datas.CARTEIRA })
  const aquisicoes = resolveBase({ ...input, tipo: 'AQUISICOES', dataEsperada: datas.AQUISICOES })
  const liquidacoes = resolveBase({ ...input, tipo: 'LIQUIDACOES', dataEsperada: datas.LIQUIDACOES })
  return {
    dataOperacional: input.dataOperacional,
    dataD1: datas.ESTOQUE,
    dataD2: datas.CARTEIRA,
    estoque,
    carteira,
    aquisicoes,
    liquidacoes,
    statusGeral: statusGeral([estoque, carteira, aquisicoes, liquidacoes]),
  }
}

export function execucaoExposicaoCompativelComBase(
  execution: { data_operacional: string; data_referencia_estoque: string; data_referencia_pl: string } | null,
  base: BaseFinanceiraDaData,
) {
  return Boolean(execution
    && execution.data_operacional === base.dataOperacional
    && execution.data_referencia_estoque === base.dataD1
    && execution.data_referencia_pl === base.dataD2)
}

