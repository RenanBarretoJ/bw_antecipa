export const TIPOS_BASE_FINANCEIROS = ['CARTEIRA', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'] as const
export type TipoBaseFinanceiro = typeof TIPOS_BASE_FINANCEIROS[number]
export type OrigemImportacaoFinanceira = 'MANUAL' | 'CRON' | 'GOLDEN_DATASET'
export type CompletudeImportacaoFinanceira = 'COMPLETO_COM_DADOS' | 'COMPLETO_VAZIO' | 'INCOMPLETO'
export type StatusImportacaoFinanceira = 'RECEBIDA' | 'VALIDANDO' | 'VALIDA' | 'PUBLICADA' | 'FALHA' | 'RETIFICADA' | 'CANCELADA'

export interface LinhaFinanceiraProcessada {
  numeroLinha: number
  status: 'VALIDA' | 'INVALIDA' | 'WARNING'
  dadosBrutos: Record<string, string>
  dadosNormalizados: Record<string, string>
  erros: string[]
  avisos: string[]
}

export interface ResultadoParseFinanceiro {
  tipoBase: TipoBaseFinanceiro
  layoutNome: string
  versaoLayout: 'RLX_V1'
  encoding: 'utf-8' | 'windows-1252'
  completude: CompletudeImportacaoFinanceira
  linhas: LinhaFinanceiraProcessada[]
  errosArquivo: string[]
  valorTotal: string | null
}

export interface IngestaoFinanceiraInput {
  fundoId: string
  provedor: string
  tipoBase: TipoBaseFinanceiro
  dataReferencia: string
  origem: OrigemImportacaoFinanceira
  arquivo: Uint8Array
  nomeArquivo: string
  mimeType: string
  atorUsuarioId?: string | null
  integracaoFundoVersaoId?: string | null
}

export interface IngestaoFinanceiraResultado {
  importacaoId: string
  status: StatusImportacaoFinanceira
  duplicada: boolean
  resultado: ResultadoParseFinanceiro
}
