import Decimal from 'decimal.js'
import type { ClassificacaoLogisticaPreCessao } from '@/lib/logistica/evidencias-logisticas'
import type { LogisticsSnapshotRow } from './types'

type StockRow = Record<string, unknown> & { id: string }
type MatchRow = Record<string, unknown> & { id: string; origem_registro_id: string }

const text = (value: unknown) => value === null || value === undefined || value === '' ? null : String(value)

export function projetarPosicaoLogistica(input: {
  estoque: StockRow
  matching: MatchRow | null
  classificacao: ClassificacaoLogisticaPreCessao | null
  nfCompartilhada: boolean
}): LogisticsSnapshotRow {
  const { estoque, matching, classificacao } = input
  const matched = matching?.status === 'MATCH_FORTE' && Boolean(matching.nota_fiscal_id)
  const valorAquisicao = text(estoque.valor_aquisicao)
  return {
    estoquePosicaoId: estoque.id,
    matchingResultadoId: matching?.id || null,
    matchingStatus: String(matching?.status || 'NAO_CONCILIADO') as LogisticsSnapshotRow['matchingStatus'],
    matchingMetodo: String(matching?.metodo || 'NAO_CONCILIADO'),
    statusVinculo: matched ? 'MATCHED_FINANCEIRO_NF' : 'SEM_MATCH_FINANCEIRO_NF',
    vinculoId: matched ? text(matching?.vinculo_id) : null,
    notaFiscalId: matched ? text(matching?.nota_fiscal_id) : null,
    statusLogistico: matched ? classificacao?.status || 'INDETERMINADA' : null,
    idRecebivel: text(estoque.id_recebivel),
    seuNumero: text(estoque.seu_numero),
    numeroDocumento: text(estoque.numero_documento),
    cedenteNome: text(estoque.cedente_nome),
    cedenteDocumento: text(estoque.cedente_documento),
    sacadoNome: text(estoque.sacado_nome),
    sacadoDocumento: text(estoque.sacado_documento),
    dataVencimento: text(estoque.data_vencimento_original ?? estoque.data_vencimento),
    valorNominal: text(estoque.valor_nominal),
    valorAquisicao,
    valorAquisicaoQualidade: valorAquisicao === null ? 'AUSENTE' : 'PRESENTE',
    nfCompartilhadaEntrePosicoes: matched && input.nfCompartilhada,
    evidenciaFamilia: matched ? classificacao?.familiaVencedora || null : null,
    documentoId: matched ? classificacao?.documentoId || null : null,
    documentoVersaoId: matched ? classificacao?.versaoId || null : null,
    documentoAnaliseId: matched ? classificacao?.analiseId || null : null,
    fundamento: matched ? classificacao?.fundamento || 'sem_evidencia_aprovada' : 'sem_match_financeiro_nf',
    evidencias: matched ? { classificacao } : {},
    detalhes: {
      valor_aquisicao_nulo_preservado: valorAquisicao === null,
      matching_status_original: matching?.status || null,
      matching_metodo_original: matching?.metodo || null,
    },
  }
}
export function somarValoresConhecidos(rows: LogisticsSnapshotRow[]) {
  const sum = (predicate: (row: LogisticsSnapshotRow) => boolean) => {
    const values = rows.filter(predicate).map((row) => row.valorAquisicao).filter((value): value is string => value !== null)
    return values.length ? values.reduce((total, value) => total.plus(value), new Decimal(0)).toFixed(2) : null
  }
  return {
    total: sum(() => true),
    matched: sum((row) => row.statusVinculo === 'MATCHED_FINANCEIRO_NF'),
    semMatch: sum((row) => row.statusVinculo === 'SEM_MATCH_FINANCEIRO_NF'),
    entregue: sum((row) => row.statusLogistico === 'ENTREGUE'),
    emTransito: sum((row) => row.statusLogistico === 'EM_TRANSITO'),
    indeterminada: sum((row) => row.statusLogistico === 'INDETERMINADA'),
  }
}
