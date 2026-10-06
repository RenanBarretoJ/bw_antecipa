import type { NfParsedData, NfParsedParcela } from '@/lib/nf-parser'
import type { NfPdfExtracted } from '@/lib/pdf-nf-parser'
import type { NfseExtraction } from '@/lib/nfse/contracts'
import type { NfseReview } from '@/lib/nfse/persistence'

export type DomainActor =
  | { type: 'HUMAN'; userId: string }
  | { type: 'SYSTEM'; source: 'EMAIL_INTAKE'; integrationId: string; messageId: string;
      attachmentId: string; attachmentToken: string }

export type FiscalScope = {
  fundoId: string; cedenteId: string; cedenteFundoId: string; estabelecimentoId: string
  cnpj: string; razaoSocial: string
}
export type FiscalFacts =
  | { kind: 'XML'; documentType: 'NFE'; key: string; issuerCnpj: string; parsed: NfParsedData }
  | { kind: 'DANFE'; documentType: 'NFE'; key: string; issuerCnpj: string; parsed: NfPdfExtracted }
  | { kind: 'NFSE'; documentType: 'NFSE'; key: string; issuerCnpj: string; parsed: NfseExtraction }

export type FiscalClaim = { id: string; token: string; generation: number }
export type FiscalStorageIntent = { id: string; bucket: 'notas-fiscais' | 'documentos-v2'; path: string }
export type FiscalImportResult =
  | { status: 'IMPORTED'; nfId: string; numero: string }
  | { status: 'COMPANION_LINKED'; nfId: string; numero: string }
  | { status: 'REQUIRES_REVIEW'; review: NfseReview }
  | { status: 'DUPLICATE' | 'IN_PROGRESS' | 'UNKNOWN_CEDENTE' | 'ROUTING_DENIED' | 'AMBIGUOUS'
      | 'INVALID' | 'MISSING_IDENTITY' | 'RETRYABLE_ERROR' | 'FAILED' | 'CLEANUP_PENDING' | 'WAITING_CANONICAL_XML' }
export type FiscalValues = {
  numero_nf: string; chave_acesso: string; data_emissao: string; data_vencimento: string
  cnpj_emitente: string; razao_social_emitente: string; cnpj_destinatario: string; razao_social_destinatario: string
  valor_bruto: number; valor_liquido: number | null
  valor_icms: number; valor_iss: number; valor_pis: number; valor_cofins: number; valor_ipi: number
  serie?: string | null; descricao_itens?: string | null; condicao_pagamento?: string | null
  quantidade_total?: number | null; unidade_quantidade?: string | null; itens_estruturados?: NfParsedData['itensEstruturados'] | null
  tipo_documento_fiscal: 'NFE' | 'NFSE'; valor_liquido_origem?: string; vencimento_origem?: string
  fiscal_proveniencia?: Record<string, unknown>
}
export type PreparedFiscal = { values: FiscalValues; parcelas: NfParsedParcela[] }

export class FiscalIntakeError extends Error {
  constructor(readonly code: 'INVALID' | 'AMBIGUOUS' | 'MISSING_IDENTITY' | 'DENIED' | 'LEASE_LOST' | 'INFRASTRUCTURE') {
    super(code)
    this.name = 'FiscalIntakeError'
  }
}
