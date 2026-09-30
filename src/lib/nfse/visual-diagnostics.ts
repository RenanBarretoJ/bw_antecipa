import type { NfseExtractionGate } from './contracts'

const contractFacts = ['numero_nfse', 'chave_acesso_nfse', 'data_emissao', 'competencia', 'prestador_cnpj', 'prestador_nome',
  'tomador_cnpj', 'tomador_nome', 'valor_operacao_servico', 'valor_liquido_nfse',
  'valor_liquido_nfse_mais_ibscbs', 'total_retencoes', 'desconto_incondicionado', 'vencimento'] as const
const contractPaths = new Set(['document', 'document_kind', 'fingerprint', 'document_count', 'ambiguous', 'confidence',
  ...contractFacts, ...contractFacts.flatMap(field => [`${field}.value`, `${field}.label`])])
const contractCodes = new Set(['invalid_type', 'invalid_value', 'too_small', 'too_big',
  'unrecognized_keys', 'invalid_format', 'invalid_contract'])
type ContractIssue = { field: string; code: string }

function sanitizeContract(issues: readonly ContractIssue[]) {
  const unique = new Map<string, ContractIssue>()
  for (const issue of issues) {
    const field = contractPaths.has(issue.field) ? issue.field : 'document'
    const code = contractCodes.has(issue.code) ? issue.code : 'invalid_contract'
    unique.set(`${field}:${code}`, { field, code })
  }
  return [...unique.values()]
}

/** Keep only known paths/codes, never Zod messages, received values, unknown keys or the input. */
export class NfseVisualContractError extends Error {
  readonly diagnostic: { contract_issues: ContractIssue[] }
  constructor(issues: readonly { path: readonly PropertyKey[]; code: string }[]) {
    super('NFSE_VISUAL_INVALID_CONTRACT')
    this.diagnostic = { contract_issues: sanitizeContract(issues.map(issue => ({
      field: issue.path.every(part => typeof part === 'string') ? issue.path.join('.') : 'document',
      code: issue.code,
    }))) }
  }
}

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
  if (error instanceof NfseVisualContractError) return {
    failed_fields: [], reasons: [], contract_issues: sanitizeContract(error.diagnostic.contract_issues),
  }
  if (!(error instanceof NfseVisualFiscalError)) return undefined
  return sanitize(error.diagnostic.failed_fields, error.diagnostic.reasons)
}
