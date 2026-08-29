import Decimal from 'decimal.js'
import { resolverExpectativasCicloFinanceiro } from '@/lib/financeiro/ingestao/cron-contract'
import {
  selecionarPlReferenciaTemporal,
  type PlReferenciaResolvido,
} from '@/lib/financeiro/pl-referencia'
import type { ImportacaoFinanceira } from '@/types/database'

export type EstadoBaseFinanceira = 'VALOR' | 'ZERO' | 'SEM_MOVIMENTO' | 'DISPONIVEL' | 'INDISPONIVEL'
export type StatusGeralBaseFinanceira = 'PRONTA' | 'BASE_INCOMPLETA' | 'SEM_MOVIMENTO' | 'INDISPONIVEL'

export type ImportacaoResumoBase = Pick<ImportacaoFinanceira,
  'id' | 'tipo_base' | 'data_referencia' | 'completude' | 'declaracao_sem_movimento' |
  'origem' | 'provedor' | 'linhas_publicadas' | 'valor_total' | 'publicada_em'
> & { fundo_id?: string; status?: string; hash_conteudo?: string | null }

export type SnapshotCarteiraResumo = {
  id?: string
  importacao_id: string
  fundo_id?: string
  data_referencia?: string
  patrimonio_liquido: string | number
  vigente: boolean
  publicada_em?: string | null
}

export type BaseFinanceiraResolvida = {
  tipo: ImportacaoFinanceira['tipo_base']
  dataEsperada: string
  dataReferencia: string | null
  defasagem: string | null
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
  return { tipo, dataEsperada, dataReferencia: null, defasagem: null, estado: 'INDISPONIVEL', valor: null, importacaoId: null, origem: null, provedor: null, origemQa: false }
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
    dataReferencia: importacao.data_referencia,
    defasagem: null,
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
  fundoId?: string
  importacoes: ImportacaoResumoBase[]
  snapshots: SnapshotCarteiraResumo[]
  plReferencia?: PlReferenciaResolvido | null
}): BaseFinanceiraDaData {
  const datas = resolverExpectativasCicloFinanceiro(input.dataOperacional)
  const estoque = resolveBase({ ...input, tipo: 'ESTOQUE', dataEsperada: datas.ESTOQUE })
  const aquisicoes = resolveBase({ ...input, tipo: 'AQUISICOES', dataEsperada: datas.AQUISICOES })
  const liquidacoes = resolveBase({ ...input, tipo: 'LIQUIDACOES', dataEsperada: datas.LIQUIDACOES })
  const escopoFundo = input.fundoId || '__escopo_consulta__'
  const plReferencia = input.plReferencia === undefined
    ? selecionarPlReferenciaTemporal({
        fundoId: escopoFundo,
        dataOperacional: input.dataOperacional,
        candidatos: input.importacoes
          .filter((item) => item.tipo_base === 'CARTEIRA')
          .flatMap((importacao) => input.snapshots
            .filter((snapshot) => snapshot.importacao_id === importacao.id)
            .map((snapshot) => ({
              fundoId: snapshot.fundo_id || importacao.fundo_id || escopoFundo,
              snapshotId: snapshot.id || `${importacao.id}:snapshot`,
              importacaoId: importacao.id,
              dataBase: snapshot.data_referencia || importacao.data_referencia,
              patrimonioLiquido: String(snapshot.patrimonio_liquido),
              snapshotVigente: snapshot.vigente,
              snapshotPublicadaEm: snapshot.publicada_em || null,
              importacaoPublicadaEm: importacao.publicada_em,
              importacaoStatus: importacao.status || 'PUBLICADA',
              importacaoTipoBase: importacao.tipo_base,
              importacaoCompletude: importacao.completude,
              importacaoOrigem: importacao.origem,
              importacaoProvedor: importacao.provedor,
              importacaoHashConteudo: importacao.hash_conteudo || null,
            }))),
      })
    : input.plReferencia
  const carteira: BaseFinanceiraResolvida = plReferencia
    ? {
        tipo: 'CARTEIRA',
        dataEsperada: datas.CARTEIRA,
        dataReferencia: plReferencia.dataBase,
        defasagem: plReferencia.defasagem,
        estado: 'VALOR',
        valor: plReferencia.patrimonioLiquido,
        importacaoId: plReferencia.importacaoId,
        origem: plReferencia.origemCodigo,
        provedor: plReferencia.provedor,
        origemQa: plReferencia.origem === 'QA SYNTHETIC',
      }
    : indisponivel('CARTEIRA', datas.CARTEIRA)
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
    && base.carteira.dataReferencia !== null
    && execution.data_referencia_pl === base.carteira.dataReferencia)
}
