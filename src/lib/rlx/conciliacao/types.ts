export const RLX_MATCH_RULE_VERSION = 'RLX_MATCH_V1' as const
export const RLX_RECON_RULE_VERSION = 'RLX_RECON_V1' as const

export const RLX_MATCH_STATUSES = ['MATCH_FORTE', 'AMBIGUO', 'NAO_CONCILIADO', 'CONFLITO'] as const
export type RlxMatchStatus = typeof RLX_MATCH_STATUSES[number]

export const RLX_MATCH_METHODS = [
  'CHAVE_NFE',
  'SEU_NUMERO',
  'COMPOSTO',
  'ID_RECEBIVEL',
  'AMBIGUO',
  'NAO_CONCILIADO',
  'CONFLITO',
] as const
export type RlxMatchMethod = typeof RLX_MATCH_METHODS[number]

export const RLX_RECONCILIATION_STATUSES = [
  'MANTIDO_CORRETO',
  'ENTRADA_INCORPORADA',
  'ENTRADA_NAO_INCORPORADA',
  'ENTRADA_SEM_AQUISICAO',
  'SAIDA_REFLETIDA',
  'SAIDA_NAO_REFLETIDA',
  'SAIDA_SEM_LIQUIDACAO',
  'LIQUIDADO_AINDA_NO_ESTOQUE',
  'DIVERGENCIA_VALOR',
  'NAO_CONCILIADO',
  'BASE_INCOMPLETA',
  'RETIFICACAO_ESTOQUE',
  'RETIFICACAO_AQUISICAO',
  'LIQUIDACAO_REPETIDA_MESMO_DIA',
  'LIQUIDACAO_PARCIAL_SALDO',
  'DIA_SEM_MOVIMENTO',
  'ARQUIVO_DUPLICADO_HASH',
] as const
export type RlxReconciliationStatus = typeof RLX_RECONCILIATION_STATUSES[number]

export type RlxExternalSource = {
  id: string
  fundoId: string
  provedor: string
  origem: 'ESTOQUE' | 'AQUISICAO' | 'LIQUIDACAO'
  externalTitleKey: string | null
  idRecebivel: string | null
  seuNumero: string | null
  chaveNfe: string | null
  numeroDocumento: string | null
  cedenteDocumento: string | null
  cedenteNome?: string | null
  sacadoDocumento: string | null
  sacadoNome?: string | null
  dataVencimento: string | null
  valorReferencia: string | null
  tipoRecebivel: string | null
}

export type RlxNoteCandidate = {
  id: string
  fundoId: string
  numero: string
  chaveAcesso: string | null
  cedenteDocumento: string
  cedenteNome: string
  sacadoDocumento: string
  sacadoNome: string
  dataVencimento: string
  valorBruto: string
}

export type RlxKnownCrosswalk = {
  vinculoId: string
  fundoId: string
  provedor: string
  notaFiscalId: string
  origem: 'AUTOMATICO' | 'MANUAL'
  tipoChave: 'CHAVE_NFE' | 'ID_RECEBIVEL' | 'SEU_NUMERO' | 'EXTERNAL_TITLE_KEY' | 'DOCUMENTO' | 'NOSSO_NUMERO'
  valorNormalizado: string
}

export type RlxMatchCandidate = {
  notaFiscalId: string
  metodo: RlxMatchMethod
  evidencias: Record<string, unknown>
}

export type RlxMatchResult = {
  source: RlxExternalSource
  status: RlxMatchStatus
  metodo: RlxMatchMethod
  notaFiscalId: string | null
  vinculoId: string | null
  candidates: RlxMatchCandidate[]
  evidencias: Record<string, unknown>
}

export type RlxReconciliationRow = {
  identidadeExterna: string | null
  fundoId: string
  provedor: string
  valorAquisicao: string | null
  valorMovimento?: string | null
  tipoMovimento?: string | null
  statusRecebivel?: string | null
  notaFiscalId?: string | null
  vinculoId?: string | null
}

export type RlxReconciliationContext = {
  estoqueRetificadoIdentidades?: ReadonlySet<string>
  aquisicaoRetificadaIdentidades?: ReadonlySet<string>
  identidadesSemConciliacao?: ReadonlySet<string>
  liquidacaoExigeSaidaIdentidades?: ReadonlySet<string>
  diaSemMovimentoIdentidades?: ReadonlySet<string>
  arquivoDuplicadoIdentidades?: ReadonlySet<string>
}

export type RlxReconciliationResult = {
  identidadeExterna: string
  fundoId: string
  provedor: string
  notaFiscalId: string | null
  vinculoId: string | null
  presenteD2: boolean
  presenteD1: boolean
  valorAquisicaoD2: string | null
  valorAquisicaoD1: string | null
  aquisicoesCount: number
  aquisicoesValor: string
  liquidacoesCount: number
  liquidacoesValorPago: string
  status: RlxReconciliationStatus
  detalhes: Record<string, unknown>
}
