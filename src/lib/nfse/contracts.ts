/** Fatos fiscais impressos; nenhum destes valores representa desconto financeiro. */
export interface NfseFiscalData {
  numero_nf: string
  chave_acesso: string
  codigo_verificacao: string
  orgao_emissor: string
  cnpj_emitente: string
  razao_social_emitente: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  endereco_destinatario: string
  competencia: string
  data_emissao: string
  data_vencimento: string
  valor_bruto: number
  valor_liquido: number
  total_retencoes: number
  desconto_incondicionado: number
  valor_liquido_com_ibscbs: number
}

export type NfseField = keyof NfseFiscalData
export type NfseCandidate = {
  field: NfseField
  value: string | number
  source: 'danfse_v2_label'
  anchor: string
  line: number
  confidence: number
}

export interface NfseExtraction {
  tipo_documento: 'NFSE' | 'UNKNOWN'
  layout_fingerprint: 'danfse_v2' | 'nfse_municipal' | null
  strategy: 'danfse_v2_labels' | 'danfse_v2_visual' | 'nfse_municipal_visual' | null
  dados: Partial<NfseFiscalData>
  candidatos: Partial<Record<NfseField, NfseCandidate[]>>
  proveniencia: Partial<Record<NfseField, { source: string; anchor: string; line: number }>>
  confianca: Partial<Record<NfseField, number>>
  motivos_bloqueio: string[]
  avisos: string[]
  vencimento_source: 'DOCUMENT' | 'MISSING'
}

/** Gate de extração, não autorização de upload, autenticidade fiscal ou elegibilidade. */
export type NfseExtractionGate =
  | { ok: true }
  | { ok: false; failedFields: NfseField[]; reasons: string[] }
