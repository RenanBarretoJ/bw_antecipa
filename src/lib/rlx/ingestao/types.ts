export const RLX_TIPOS_BASE = ['CARTEIRA', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'] as const
export type RlxTipoBase = typeof RLX_TIPOS_BASE[number]
export type RlxOrigemImportacao = 'MANUAL' | 'CRON' | 'GOLDEN_DATASET'
export type RlxCompletude = 'COMPLETO_COM_DADOS' | 'COMPLETO_VAZIO' | 'INCOMPLETO'
export type RlxStatusImportacao = 'RECEBIDA' | 'VALIDANDO' | 'VALIDA' | 'PUBLICADA' | 'FALHA' | 'RETIFICADA' | 'CANCELADA'

export interface RlxLinhaProcessada {
  numeroLinha: number
  status: 'VALIDA' | 'INVALIDA' | 'WARNING'
  dadosBrutos: Record<string, string>
  dadosNormalizados: Record<string, string>
  erros: string[]
  avisos: string[]
}

export interface RlxResultadoParse {
  tipoBase: RlxTipoBase
  layoutNome: string
  versaoLayout: 'RLX_V1'
  encoding: 'utf-8' | 'windows-1252'
  completude: RlxCompletude
  linhas: RlxLinhaProcessada[]
  errosArquivo: string[]
  valorTotal: string | null
}

export interface RlxIngestaoInput {
  fundoId: string
  provedor: string
  tipoBase: RlxTipoBase
  dataReferencia: string
  origem: RlxOrigemImportacao
  arquivo: Uint8Array
  nomeArquivo: string
  mimeType: string
  atorUsuarioId?: string | null
  integracaoFundoVersaoId?: string | null
}

export interface RlxIngestaoResultado {
  importacaoId: string
  status: RlxStatusImportacao
  duplicada: boolean
  resultado: RlxResultadoParse
}
