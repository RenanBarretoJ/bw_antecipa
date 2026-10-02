import { z } from 'zod'
import { parseDanfeMoney } from '../danfe/money'
import { validarCNPJ } from '../validations/cedente'
import type { NfseExtraction, NfseField } from './contracts'

const printed = z.object({ value: z.string().max(200).nullable(), label: z.string().max(200).nullable() }).strict()
const fields = {
  numero_nf: printed, codigo_verificacao: printed, data_emissao: printed,
  cnpj_emitente: printed, razao_social_emitente: printed,
  cnpj_destinatario: printed, razao_social_destinatario: printed,
  valor_bruto: printed, valor_liquido: printed, data_vencimento: printed,
}
const schema = z.object({
  document_kind: z.literal('nfse_municipal'), document_count: z.literal(1), ambiguous: z.literal(false),
  titulo: z.string().min(8).max(200), orgao_emissor: z.string().min(8).max(200),
  confidence: z.number().min(0.85).max(1), ...fields,
}).strict()

export const normalizeMunicipalAuthority = (value: string) => value.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()

const labels: Record<keyof typeof fields, RegExp> = {
  numero_nf: /^(?:NUMERO (?:DA (?:NOTA|NFS-E)|DA NOTA FISCAL)|N[º°.]? (?:DA )?NOTA|NFS-E)$/,
  codigo_verificacao: /^CODIGO (?:DE )?(?:AUTENTICIDADE|VERIFICACAO)$/,
  data_emissao: /^DATA (?:DE |E HORA (?:DE |DA )?)?EMISSAO$/,
  cnpj_emitente: /^(?:CNPJ(?:\s*\/\s*CPF)?|CPF\s*\/\s*CNPJ)$/,
  cnpj_destinatario: /^(?:CNPJ(?:\s*\/\s*CPF)?|CPF\s*\/\s*CNPJ)$/,
  razao_social_emitente: /^(?:PRESTADOR (?:DE SERVICOS)?|NOME(?: (?:DO )?PRESTADOR (?:DE SERVICOS)?)?|RAZAO SOCIAL|NOME\s*\/\s*RAZAO SOCIAL)$/,
  razao_social_destinatario: /^(?:TOMADOR (?:DE SERVICOS)?|NOME(?: (?:DO )?TOMADOR (?:DE SERVICOS)?)?|RAZAO SOCIAL|NOME\s*\/\s*RAZAO SOCIAL)$/,
  valor_bruto: /^VALOR (?:TOTAL (?:DA NOTA|DOS SERVICOS|DA NFS-E)|DOS SERVICOS)$/,
  valor_liquido: /^VALOR LIQUIDO(?: (?:DA NOTA|DA NFS-E))?$/,
  data_vencimento: /^(?:DATA (?:DE )?)?VENCIMENTO$/,
}

function date(raw: string): string | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/.exec(raw)
  if (!match) return
  const iso = `${match[3]}-${match[2]}-${match[1]}`
  const parsed = new Date(`${iso}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : undefined
}

/** Municipal verification codes are not national access keys. No generated key or net value. */
export function validateMunicipalVisual(input: unknown): NfseExtraction {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new Error('NFSE_VISUAL_MUNICIPAL_CONTRACT_INVALID')
  const candidate = parsed.data
  const authority = normalizeMunicipalAuthority(candidate.orgao_emissor)
  const title = normalizeMunicipalAuthority(candidate.titulo)
  if (!/(?:NOTA FISCAL.*SERVICOS|\bNFS-E\b)/.test(title)
    || !/^(?:PREFEITURA|MUNICIPIO|SECRETARIA)/.test(authority)
    || /[^A-Z0-9 /().,'-]/.test(authority)
    || /[\r\n]/.test(candidate.orgao_emissor)) throw new Error('NFSE_VISUAL_MUNICIPAL_FINGERPRINT_INVALID')
  const result: NfseExtraction = {
    tipo_documento: 'NFSE', layout_fingerprint: 'nfse_municipal', strategy: 'nfse_municipal_visual',
    dados: { orgao_emissor: authority }, candidatos: {}, confianca: { orgao_emissor: candidate.confidence },
    proveniencia: { orgao_emissor: { source: 'PDF_VISUAL_FALLBACK', anchor: candidate.orgao_emissor, line: 0 } },
    motivos_bloqueio: [], avisos: [], vencimento_source: 'MISSING',
  }
  for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
    const fact = candidate[field]
    if (fact.value === null) continue
    if (!fact.label || !labels[field].test(normalizeMunicipalAuthority(fact.label))
      || /[\r\n]/.test(fact.value)) throw new Error('NFSE_VISUAL_LABEL_CONFLICT')
    const raw = fact.value.trim()
    let value: string | number | undefined
    if (field === 'numero_nf') {
      const number = raw.replace(/\./g, '').replace(/^0+/, '')
      if (/^\d[\d.]{0,20}$/.test(raw) && /^[1-9]\d{0,14}$/.test(number)) value = number
    } else if (field === 'codigo_verificacao') {
      if (/^[A-Za-z0-9][A-Za-z0-9.\/-]{3,79}$/.test(raw)) value = raw
    } else if (field.startsWith('cnpj_')) {
      if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(raw) && validarCNPJ(raw)) value = raw.replace(/\D/g, '')
    } else if (field.startsWith('data_')) value = date(raw)
    else if (field.startsWith('valor_')) {
      const money = parseDanfeMoney(raw)
      if (money.ok && money.value > 0) value = money.value
    } else if (raw.length >= 3) value = raw
    if (value === undefined) throw new Error('NFSE_VISUAL_INVALID_FIELD')
    Object.assign(result.dados, { [field]: value })
    result.confianca[field] = Math.min(candidate.confidence, 0.96)
    result.proveniencia[field] = { source: 'PDF_VISUAL_FALLBACK', anchor: fact.label, line: 0 }
  }
  const required: NfseField[] = ['numero_nf', 'codigo_verificacao', 'cnpj_emitente', 'razao_social_emitente',
    'cnpj_destinatario', 'razao_social_destinatario', 'data_emissao', 'valor_bruto']
  if (required.some(field => result.dados[field] === undefined)) throw new Error('NFSE_VISUAL_MUNICIPAL_FIELDS_MISSING')
  const { valor_liquido: net, valor_bruto: gross, data_emissao: issued, data_vencimento: due } = result.dados
  if (net !== undefined && net > gross!) throw new Error('NFSE_VISUAL_FISCAL_CONFLICT')
  if (due && due < issued!) throw new Error('NFSE_VISUAL_FISCAL_CONFLICT')
  if (due) result.vencimento_source = 'DOCUMENT'
  return result
}

const printedJson = { type: 'object', additionalProperties: false,
  properties: { value: { type: ['string', 'null'] }, label: { type: ['string', 'null'] } }, required: ['value', 'label'] }
export const MUNICIPAL_NFSE_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    document_kind: { type: 'string', enum: ['nfse_municipal', 'uncertain'] },
    document_count: { type: 'integer' }, ambiguous: { type: 'boolean' },
    titulo: { type: 'string' }, orgao_emissor: { type: 'string' }, confidence: { type: 'number' },
    ...Object.fromEntries(Object.keys(fields).map(field => [field, printedJson])),
  }, required: ['document_kind', 'document_count', 'ambiguous', 'titulo', 'orgao_emissor', 'confidence', ...Object.keys(fields)],
}
