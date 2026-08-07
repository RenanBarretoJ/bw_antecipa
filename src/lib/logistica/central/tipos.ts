import type { StatusLogisticoPreCessao } from '@/lib/logistica/evidencias-logisticas'

export const CENTRAL_LOGISTICA_TABS = ['geral', 'notas', 'pendencias', 'ctes'] as const
export type CentralLogisticaTab = (typeof CENTRAL_LOGISTICA_TABS)[number]

export const STATUS_DOCUMENTO_LOGISTICO = [
  'NAO_ENVIADO',
  'AGUARDANDO_ANALISE',
  'APROVADO',
  'REJEITADO',
] as const
export type StatusDocumentoCentral = (typeof STATUS_DOCUMENTO_LOGISTICO)[number]

export const MOMENTOS_DOCUMENTO = ['ANTECIPADO', 'POS_CESSAO', 'INDETERMINADO'] as const
export type MomentoDocumentoLogistico = (typeof MOMENTOS_DOCUMENTO)[number]

export const CRITICIDADES_LOGISTICAS = ['CRITICA', 'ALTA', 'MEDIA', 'NORMAL', 'CONCLUIDA'] as const
export type CriticidadeLogistica = (typeof CRITICIDADES_LOGISTICAS)[number]

export const FILTROS_PENDENCIA_LOGISTICA = [
  'rejeitada',
  'vencida',
  'vence_hoje',
  'proximos_3_dias',
  'proximos_7_dias',
  'aguardando_envio',
  'em_analise',
  'sem_pendencia',
] as const
export type FiltroPendenciaLogistica = (typeof FILTROS_PENDENCIA_LOGISTICA)[number]

export const VISOES_RAPIDAS_LOGISTICA = [
  'atencao_imediata',
  'aguardando_gestor',
  'enviados_antecipadamente',
  'entregues_na_cessao',
  'em_transito_na_cessao',
  'indeterminadas',
] as const
export type VisaoRapidaLogistica = (typeof VISOES_RAPIDAS_LOGISTICA)[number]

export type PeriodoLogistica = 'emissao' | 'operacao' | 'cessao' | 'desembolso' | 'vencimento'

export interface FiltrosCentralLogistica {
  tab: CentralLogisticaTab
  pagina: number
  limite: 20 | 50 | 100
  busca: string
  cedente: string | null
  sacado: string | null
  operacao: string | null
  statusLogistico: StatusLogisticoPreCessao | null
  statusCte: StatusDocumentoCentral | null
  statusComprovante: StatusDocumentoCentral | null
  momentoCte: MomentoDocumentoLogistico | null
  momentoComprovante: MomentoDocumentoLogistico | null
  pendencia: FiltroPendenciaLogistica | null
  statusOperacao: string | null
  periodo: PeriodoLogistica
  dataDe: string
  dataAte: string
  visao: VisaoRapidaLogistica | null
}

export interface DocumentoLogisticoCentral {
  familia: 'cte' | 'comprovante_entrega'
  status: StatusDocumentoCentral
  documentoId: string | null
  versaoAtualId: string | null
  versaoAprovadaId: string | null
  primeiraVersao: number | null
  versaoAtual: number | null
  primeiraVersaoNome: string | null
  versaoAtualNome: string | null
  primeiroUploadEm: string | null
  ultimoUploadEm: string | null
  aprovadoEm: string | null
  momento: MomentoDocumentoLogistico
  diasRelativosCessao: number | null
  quantidadeNfs: number
  prazoOriginal: string | null
  novaPrevisao: string | null
  prazoEfetivo: string | null
  obrigatorio: boolean
}

export interface OperacaoLogisticaResumo {
  id: string
  status: string
  criadaEm: string
  aprovadaEm: string | null
  desembolsadaEm: string | null
  dataCessao: string | null
}

export interface CumprimentoDocumentalLogistico {
  obrigatorios: number
  aprovados: number
  pendentes: number
  completo: boolean
}

export interface PrazoLogisticoRelevante {
  documento: 'CT-e / DACTE' | 'Comprovante de entrega' | null
  data: string | null
  prazoOriginal: string | null
  novaPrevisao: string | null
  dias: number | null
  situacao: 'rejeitado' | 'vencido' | 'vence_hoje' | 'proximo' | 'aguardando_envio' | 'em_analise' | 'sem_pendencia'
}

export interface LogisticaNfResumo {
  notaFiscalId: string
  numeroNf: string
  chaveAcesso: string | null
  cedente: string
  cedenteCnpj: string
  sacado: string
  sacadoCnpj: string
  valor: number
  emissao: string
  vencimento: string
  operacao: OperacaoLogisticaResumo | null
  statusAtual: StatusLogisticoPreCessao
  statusCriacao: StatusLogisticoPreCessao | null
  statusAprovacao: StatusLogisticoPreCessao | null
  gateObrigatorio: boolean
  cte: DocumentoLogisticoCentral
  referenciasCte: string[]
  comprovante: DocumentoLogisticoCentral
  cumprimentoDocumental: CumprimentoDocumentalLogistico
  prazoRelevante: PrazoLogisticoRelevante
  criticidade: CriticidadeLogistica
  pendencias: PendenciaLogistica[]
  ultimaAtualizacao: string
}

export interface PendenciaLogistica {
  id: string
  notaFiscalId: string
  numeroNf: string
  cedente: string
  documento: 'CT-e / DACTE' | 'Comprovante de entrega'
  status: StatusDocumentoCentral
  criticidade: CriticidadeLogistica
  prazoOriginal: string | null
  novaPrevisao: string | null
  prazoEfetivo: string | null
  dias: number | null
  operacaoId: string | null
  valor: number
}

export interface CteNfRelacionada {
  notaFiscalId: string
  numeroNf: string
  operacaoId: string | null
  valor: number
  statusLogistico: StatusLogisticoPreCessao
  statusDocumental: StatusDocumentoCentral
}

export interface CteLogisticoResumo {
  cteId: string
  chave: string | null
  numero: string | null
  cedente: string
  cedenteCnpj: string
  quantidadeNfs: number
  valorRelacionado: number
  status: StatusDocumentoCentral
  primeiroUploadEm: string | null
  momento: MomentoDocumentoLogistico | 'MISTO'
  aprovadoEm: string | null
  operacoesRelacionadas: number
  nfs: CteNfRelacionada[]
}

export interface MetricaQuantidadeValor {
  quantidade: number
  valor: number
}

export interface ResumoCentralLogistica {
  acompanhadas: MetricaQuantidadeValor
  entregues: MetricaQuantidadeValor
  emTransito: MetricaQuantidadeValor
  indeterminadas: MetricaQuantidadeValor
  pendenciasVencidas: MetricaQuantidadeValor
  aguardandoAnalise: number
  rejeitados: number
  enviadosAntecipadamente: { quantidade: number; percentual: number }
}

export interface IndicadoresComportamentoLogistico {
  entreguesNaCriacaoPercentual: number | null
  emTransitoNaCriacaoPercentual: number | null
  ctesAntecipadosPercentual: number | null
  comprovantesAntecipadosPercentual: number | null
  mediaDiasCessaoComprovanteAprovado: number | null
  mediaDiasCessaoCteEnviado: number | null
  postergacoes: number
  documentosRejeitados: number
}

export interface OpcaoFiltroLogistica {
  value: string
  label: string
}

export interface PaginacaoCentralLogistica {
  pagina: number
  limite: 20 | 50 | 100
  total: number
  totalPaginas: number
}

export interface CentralLogisticaData {
  fundo: { id: string; nome: string }
  filtros: FiltrosCentralLogistica
  resumo: ResumoCentralLogistica
  indicadores: IndicadoresComportamentoLogistico
  notas: LogisticaNfResumo[]
  pendencias: PendenciaLogistica[]
  ctes: CteLogisticoResumo[]
  paginacao: PaginacaoCentralLogistica
  opcoes: {
    cedentes: OpcaoFiltroLogistica[]
    sacados: OpcaoFiltroLogistica[]
    operacoes: OpcaoFiltroLogistica[]
  }
  totalUniverso: number
}
