export const SERPRO_NFE_PROVIDER = 'SERPRO' as const
export const SERPRO_NFE_CONTRACT_VERSION = 'SERPRO_NFE_PUBLIC_DOC_2026-10' as const
export const SERPRO_NFE_MAPPER_VERSION = 'S1_MAPPER_V1' as const

export type FiscalSeverity = 'NEUTRO' | 'VERDE' | 'AMARELO' | 'VERMELHO'
export type FiscalQueryStatus =
  | 'NAO_APLICAVEL'
  | 'AGUARDANDO_CHAVE'
  | 'PENDENTE'
  | 'EM_CONSULTA'
  | 'CONSULTADO'
  | 'DIVERGENTE'
  | 'INCONCLUSIVO'
  | 'INDISPONIVEL'
  | 'ERRO'
  | 'NAO_SUPORTADO'

export interface FiscalSnapshot {
  chaveAcesso: string
  numeroNf: string
  serie: string
  cnpjEmitente: string
  cnpjDestinatario: string
  dataEmissao: string
  valorTotal: string | number
}

export interface FiscalEventView {
  code: string
  description: string
  protocol: string | null
  occurredAt: string | null
  sequence: string | null
  observedAt: string
  registered: boolean
  severity: Extract<FiscalSeverity, 'AMARELO' | 'VERMELHO'>
  fingerprint: string
  provenance: {
    envelope: 'procEventosNFe'
    sourceIndex: number
    code: string
    protocol: string
    occurredAt: string
  }
}

export interface FiscalAssessment {
  status: Extract<FiscalQueryStatus, 'CONSULTADO' | 'DIVERGENTE' | 'INCONCLUSIVO'>
  severity: Exclude<FiscalSeverity, 'NEUTRO'>
  summary: string
  checkedAt: string
  responseFingerprint: string
  result: Record<string, unknown>
  differences: string[]
  events: FiscalEventView[]
  eventCoverage: 'PARTIAL'
}

export interface FiscalSituationView {
  status: FiscalQueryStatus
  provider: 'SERPRO'
  capabilityState: 'UNVERIFIED' | 'VERIFIED_DISABLED' | 'ENABLED'
  eventCoverage: 'FULL' | 'PARTIAL' | 'UNSUPPORTED' | 'NOT_PROVEN'
  severity: FiscalSeverity
  summary: string
  checkedAt: string | null
  lastCallAt: string | null
  mapperVersion: string
  result: Record<string, unknown>
  differences: string[]
  events: Array<{
    code: string
    description: string
    protocol: string | null
    occurredAt: string | null
    observedAt: string
    registered: boolean
    severity: 'AMARELO' | 'VERMELHO'
  }>
}
