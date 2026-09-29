import { z } from 'zod'
import { extractDanfseV2, validateNfseExtraction } from './danfse-v2'
import type { NfseExtraction, NfseField } from './contracts'

const printed = z.object({ value: z.string().max(200).nullable(), label: z.string().max(100).nullable() }).strict()
export const visualNfseSchema = z.object({
  document_kind: z.literal('nfse_danfse_v2'),
  fingerprint: z.literal('DANFSe v2.0'),
  document_count: z.literal(1),
  ambiguous: z.literal(false),
  numero_nfse: printed, chave_acesso_nfse: printed,
  data_emissao: printed, competencia: printed,
  prestador_cnpj: printed, prestador_nome: printed,
  tomador_cnpj: printed, tomador_nome: printed,
  valor_operacao_servico: printed, valor_liquido_nfse: printed,
  valor_liquido_nfse_mais_ibscbs: printed, total_retencoes: printed,
  desconto_incondicionado: printed, vencimento: printed,
  confidence: z.number().min(0.85).max(1),
}).strict()

export type VisualNfse = z.infer<typeof visualNfseSchema>
type PrintedField = Exclude<keyof VisualNfse, 'document_kind' | 'fingerprint' | 'document_count' | 'ambiguous' | 'confidence'>
const labels: Record<PrintedField, string> = {
  numero_nfse: 'NUMERO DA NFS-E', chave_acesso_nfse: 'CHAVE DE ACESSO DA NFS-E',
  data_emissao: 'DATA E HORA DA EMISSAO DA NFS-E', competencia: 'COMPETENCIA DA NFS-E',
  prestador_cnpj: 'CNPJ / CPF / NIF', prestador_nome: 'NOME / NOME EMPRESARIAL',
  tomador_cnpj: 'CNPJ / CPF / NIF', tomador_nome: 'NOME / NOME EMPRESARIAL',
  valor_operacao_servico: 'VALOR DA OPERACAO / SERVICO', valor_liquido_nfse: 'VALOR LIQUIDO DA NFS-E',
  valor_liquido_nfse_mais_ibscbs: 'VALOR LIQUIDO DA NFS-E + IBS/CBS',
  total_retencoes: 'TOTAL DAS RETENCOES (ISSQN / FEDERAIS)',
  desconto_incondicionado: 'DESCONTO INCONDICIONADO', vencimento: 'DATA DE VENCIMENTO',
}
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase()

/** No NF-e offsets or calculated fiscal values. Only a bounded, single-document label contract. */
export function validateVisualNfse(input: unknown): NfseExtraction {
  const parsed = visualNfseSchema.safeParse(input)
  if (!parsed.success) throw new Error('NFSE_VISUAL_INVALID_CONTRACT')
  const candidate = parsed.data
  function line(field: PrintedField): string {
    const fact = candidate[field]
    if (fact.value === null) {
      if (fact.label !== null) throw new Error('NFSE_VISUAL_LABEL_WITHOUT_VALUE')
      return ''
    }
    if (!fact.label || /[\r\n]/.test(fact.value) || !fact.value.trim()) throw new Error('NFSE_VISUAL_INVALID_FIELD')
    const label = normalize(fact.label)
    if (label !== labels[field] && !(field === 'vencimento' && label === 'VENCIMENTO')) {
      throw new Error('NFSE_VISUAL_LABEL_CONFLICT')
    }
    return `${labels[field]}\n${fact.value}`
  }
  const canonical = [
    'DANFSe v2.0', 'Documento Auxiliar da NFS-e',
    ...(['numero_nfse', 'chave_acesso_nfse', 'data_emissao', 'competencia'] as const).map(line),
    'PRESTADOR / FORNECEDOR', line('prestador_cnpj'), line('prestador_nome'),
    'TOMADOR / ADQUIRENTE', line('tomador_cnpj'), line('tomador_nome'),
    'SERVICO PRESTADO', 'VALOR TOTAL DA NFS-E',
    ...(['valor_operacao_servico', 'valor_liquido_nfse', 'valor_liquido_nfse_mais_ibscbs',
      'total_retencoes', 'desconto_incondicionado', 'vencimento'] as const).map(line),
  ].filter(Boolean).join('\n')
  const result = extractDanfseV2(canonical)
  const { valor_bruto: gross, valor_liquido: net } = result.dados
  if (!validateNfseExtraction(result).ok || !result.dados.competencia
    || (net !== undefined && (!(net > 0) || net > (gross ?? 0)))) throw new Error('NFSE_VISUAL_FISCAL_CONFLICT')
  result.strategy = 'danfse_v2_visual'
  result.candidatos = {} // Do not describe generated canonical lines as native PDF evidence.
  for (const field of Object.keys(result.proveniencia) as NfseField[]) {
    result.proveniencia[field] = { ...result.proveniencia[field]!, source: 'PDF_VISUAL_FALLBACK', line: 0 }
    result.confianca[field] = Math.min(candidate.confidence, 0.96)
  }
  return result
}

// The provider is allowed to report uncertainty/multiple documents; local validation rejects them.
const factSchema = { type: 'object', additionalProperties: false,
  properties: { value: { type: ['string', 'null'] }, label: { type: ['string', 'null'] } }, required: ['value', 'label'] }
export const VISUAL_NFSE_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    document_kind: { type: 'string', enum: ['nfse_danfse_v2', 'uncertain'] },
    fingerprint: { type: ['string', 'null'] }, document_count: { type: 'integer' }, ambiguous: { type: 'boolean' },
    ...Object.fromEntries(Object.keys(labels).map(key => [key, factSchema])), confidence: { type: 'number' },
  },
  required: ['document_kind', 'fingerprint', 'document_count', 'ambiguous', ...Object.keys(labels), 'confidence'],
}
