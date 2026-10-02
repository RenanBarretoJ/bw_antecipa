import { validateNfseExtraction } from './danfse-v2'
import type { NfseExtraction } from './contracts'

export type NfseReview = {
  intentId?: string
  numero: string; bruto: number; liquido: number | null; emissao: string
  strategy: NonNullable<NfseExtraction['strategy']>
}

export function validManualDue(value: string, issued: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= issued && value >= today
}

/** REVIEW means no NF row and no Storage object may be created. */
export function prepareNfsePersistence(extraction: NfseExtraction, manualDue: string, sha256: string, today: string) {
  if (!validateNfseExtraction(extraction).ok) throw new Error('NFSE_EXTRACTION_REJECTED')
  const d = extraction.dados
  if (d.valor_liquido !== undefined && (!(d.valor_liquido > 0) || d.valor_liquido > d.valor_bruto!)) throw new Error('NFSE_NET_INVALID')
  const review: NfseReview = { numero: d.numero_nf!, bruto: d.valor_bruto!, liquido: d.valor_liquido ?? null,
    emissao: d.data_emissao!, strategy: extraction.strategy! }
  if (!d.data_vencimento && !validManualDue(manualDue, d.data_emissao!, today)) return { kind: 'review' as const, review }
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('NFSE_HASH_INVALID')
  return { kind: 'ready' as const, review, values: {
    numero_nf: d.numero_nf!, chave_acesso: d.chave_acesso ?? null, data_emissao: d.data_emissao!,
    data_vencimento: d.data_vencimento || manualDue,
    cnpj_emitente: d.cnpj_emitente!, razao_social_emitente: d.razao_social_emitente!,
    cnpj_destinatario: d.cnpj_destinatario!, razao_social_destinatario: d.razao_social_destinatario!,
    valor_bruto: d.valor_bruto!, valor_liquido: d.valor_liquido ?? null,
    tipo_documento_fiscal: 'NFSE' as const,
    valor_liquido_origem: d.valor_liquido === undefined ? 'NAO_INFORMADO' as const : 'DOCUMENTO_EXPLICITO' as const,
    vencimento_origem: d.data_vencimento ? 'DOCUMENT' as const : 'MANUAL' as const,
    fiscal_proveniencia: { strategy: extraction.strategy, source: extraction.strategy === 'danfse_v2_labels' ? 'PDF_TEXT_NATIVE' : 'PDF_VISUAL_FALLBACK',
      ...(extraction.strategy === 'nfse_municipal_visual' ? { orgao_emissor: d.orgao_emissor, codigo_verificacao: d.codigo_verificacao } : {}),
      competencia: d.competencia ?? null, sha256, vencimento_documento: d.data_vencimento ?? null,
      total_retencoes: d.total_retencoes ?? null, desconto_incondicionado: d.desconto_incondicionado ?? null,
      valor_liquido_com_ibscbs: d.valor_liquido_com_ibscbs ?? null, campos: extraction.proveniencia },
  } }
}
