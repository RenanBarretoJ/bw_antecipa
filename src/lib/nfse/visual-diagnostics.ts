import type { NfseExtractionGate } from './contracts'

// Closed vocabulary: never retain model output, fiscal values or parser payloads.
const fields = ['numero_nf', 'chave_acesso', 'cnpj_emitente', 'razao_social_emitente',
  'cnpj_destinatario', 'razao_social_destinatario', 'endereco_destinatario', 'competencia',
  'data_emissao', 'data_vencimento', 'valor_bruto', 'valor_liquido', 'total_retencoes',
  'desconto_incondicionado', 'valor_liquido_com_ibscbs'] as const
const reasons = new Set([
  ...fields.flatMap(field => [`nfse_${field}_invalid`, `nfse_${field}_conflict`]),
  'nfse_text_size_exceeded', 'nfse_layout_not_recognized', 'nfse_document_count_ambiguous',
  'nfse_party_sections_ambiguous', 'nfse_totals_section_ambiguous',
  'nfse_due_date_issue_conflict', 'nfse_totals_arithmetic_review_required',
  'competencia_missing', 'net_non_positive', 'net_exceeds_gross',
])

function sanitize(failedFields: readonly string[], codes: readonly string[]) {
  return {
    failed_fields: fields.filter(field => failedFields.includes(field)),
    reasons: [...reasons].filter(reason => codes.includes(reason)),
  }
}

export class NfseVisualFiscalError extends Error {
  readonly diagnostic: ReturnType<typeof sanitize>
  constructor(gate: NfseExtractionGate, extraFields: string[], extraReasons: string[]) {
    super('NFSE_VISUAL_FISCAL_CONFLICT')
    this.diagnostic = sanitize(gate.ok ? extraFields : [...gate.failedFields, ...extraFields],
      gate.ok ? extraReasons : [...gate.reasons, ...extraReasons])
  }
}

/** Explicit log boundary; ignore arbitrary properties and re-sanitize even typed errors. */
export function safeNfseVisualDiagnostic(error: unknown) {
  if (!(error instanceof NfseVisualFiscalError)) return undefined
  return sanitize(error.diagnostic.failed_fields, error.diagnostic.reasons)
}
