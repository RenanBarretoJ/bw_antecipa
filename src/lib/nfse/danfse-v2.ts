import { parseDanfeMoney } from '../danfe/money'
import { validarCNPJ } from '../validations/cedente'
import type { NfseExtraction, NfseExtractionGate, NfseField, NfseFiscalData } from './contracts'

const CONFIDENCE = 0.96
const MAX_TEXT_LENGTH = 1_000_000
const MIN_CRITICAL_CONFIDENCE = 0.85

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[ \t]+/g, ' ').trim().toUpperCase()
}

export function isDanfseV2(text: string): boolean {
  const normalized = normalize(text)
  return /\bDANFSE V2\.0\b/.test(normalized)
    && normalized.includes('DOCUMENTO AUXILIAR DA NFS-E')
    && normalized.includes('PRESTADOR / FORNECEDOR')
    && normalized.includes('TOMADOR / ADQUIRENTE')
}

function dateValue(raw: string): string | undefined {
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: \d{2}:\d{2}(?::\d{2})?)?$/)
  if (!match) return undefined
  const [, day, month, year] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (Number(year) < 1900 || Number(year) > 2200 || date.getUTCDate() !== Number(day)
    || date.getUTCMonth() !== Number(month) - 1 || date.getUTCFullYear() !== Number(year)) return undefined
  return `${year}-${month}-${day}`
}

function cnpjValue(raw: string): string | undefined {
  if (!/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(raw) || !validarCNPJ(raw)) return undefined
  return raw.replace(/\D/g, '')
}

function moneyValue(raw: string): number | undefined {
  const parsed = parseDanfeMoney(raw)
  return parsed.ok ? parsed.value : undefined
}

/**
 * Leitura determinística de rótulos completos, sem procurar valores em outros
 * blocos. Uma linha ausente nunca toma emprestado o próximo valor monetário.
 * A chave nacional é preservada com validação de formato (50 dígitos), não
 * submetida ao DV/offsets da NF-e e não apresentada como autenticada na SEFAZ.
 */
export function extractDanfseV2(text: string): NfseExtraction {
  const result: NfseExtraction = {
    tipo_documento: 'UNKNOWN', layout_fingerprint: null, strategy: null,
    dados: {}, candidatos: {}, proveniencia: {}, confianca: {}, motivos_bloqueio: [], avisos: [],
    vencimento_source: 'MISSING',
  }
  if (text.length > MAX_TEXT_LENGTH) {
    result.motivos_bloqueio.push('nfse_text_size_exceeded')
    return result
  }
  if (!isDanfseV2(text)) {
    result.motivos_bloqueio.push('nfse_layout_not_recognized')
    return result
  }
  result.tipo_documento = 'NFSE'
  result.layout_fingerprint = 'danfse_v2'
  result.strategy = 'danfse_v2_labels'
  const lines = text.normalize('NFC').replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '').split('\n')
  const comparable = lines.map(normalize)
  const headers = comparable.filter(line => line === 'DANFSE V2.0')
  if (headers.length !== 1) result.motivos_bloqueio.push('nfse_document_count_ambiguous')

  function collect<K extends NfseField>(
    field: K, labels: string[], parse: (value: string) => NfseFiscalData[K] | undefined,
    start = 0, end = lines.length,
  ) {
    for (let index = start; index < end; index += 1) {
      const label = labels.find(label => comparable[index] === label || comparable[index].startsWith(`${label}:`))
      if (!label) continue
      const colon = lines[index].indexOf(':')
      let raw = colon >= 0 ? lines[index].slice(colon + 1).trim() : ''
      if (!raw) {
        let next = index + 1
        while (next < end && !lines[next].trim()) next += 1
        raw = next < end ? lines[next].trim() : ''
      }
      if (!raw || raw === '-') continue
      const value = parse(raw)
      if (value === undefined) {
        result.motivos_bloqueio.push(`nfse_${field}_invalid`)
        continue
      }
      const candidate = { field, value, source: 'danfse_v2_label' as const, anchor: label, line: index + 1, confidence: CONFIDENCE }
      result.candidatos[field] = [...(result.candidatos[field] ?? []), candidate]
    }
    const candidates = result.candidatos[field] ?? []
    if (new Set(candidates.map(candidate => candidate.value)).size > 1) {
      result.motivos_bloqueio.push(`nfse_${field}_conflict`)
      result.confianca[field] = 0
      return
    }
    const selected = candidates[0]
    if (selected) {
      Object.assign(result.dados, { [field]: selected.value })
      result.confianca[field] = selected.confidence
      result.proveniencia[field] = { source: selected.source, anchor: selected.anchor, line: selected.line }
    }
  }

  const issuerStart = comparable.indexOf('PRESTADOR / FORNECEDOR')
  const recipientStart = comparable.indexOf('TOMADOR / ADQUIRENTE')
  const recipientEndOffset = comparable.slice(recipientStart + 1).findIndex(line =>
    /^(?:DESTINATARIO DA OPERACAO|INTERMEDIARIO DA OPERACAO|SERVICO PRESTADO)/.test(line))
  const recipientEnd = recipientEndOffset < 0 ? recipientStart : recipientStart + 1 + recipientEndOffset
  if (issuerStart < 0 || recipientStart <= issuerStart || recipientEnd <= recipientStart
    || comparable.filter(line => line === 'PRESTADOR / FORNECEDOR').length !== 1
    || comparable.filter(line => line === 'TOMADOR / ADQUIRENTE').length !== 1) {
    result.motivos_bloqueio.push('nfse_party_sections_ambiguous')
  } else {
    const nameValue = (value: string) => value.length >= 3 && value.length <= 200
      && !/^(?:MUNICIPIO|CODIGO IBGE|ENDERECO|E-MAIL|CNPJ|TELEFONE)/.test(normalize(value)) ? value : undefined
    collect('cnpj_emitente', ['CNPJ / CPF / NIF'], cnpjValue, issuerStart, recipientStart)
    collect('razao_social_emitente', ['NOME / NOME EMPRESARIAL'], nameValue, issuerStart, recipientStart)
    collect('cnpj_destinatario', ['CNPJ / CPF / NIF'], cnpjValue, recipientStart, recipientEnd)
    collect('razao_social_destinatario', ['NOME / NOME EMPRESARIAL'], nameValue, recipientStart, recipientEnd)
    collect('endereco_destinatario', ['ENDERECO'], nameValue, recipientStart, recipientEnd)
  }
  collect('numero_nf', ['NUMERO DA NFS-E'], raw => /^\d{1,15}$/.test(raw) && Number(raw) > 0 ? raw.replace(/^0+/, '') : undefined, 0, issuerStart)
  collect('chave_acesso', ['CHAVE DE ACESSO DA NFS-E'], raw => /^\d{50}$/.test(raw) && !/^(\d)\1+$/.test(raw) ? raw : undefined, 0, issuerStart)
  collect('data_emissao', ['DATA E HORA DA EMISSAO DA NFS-E'], dateValue, 0, issuerStart)
  collect('competencia', ['COMPETENCIA DA NFS-E'], dateValue, 0, issuerStart)
  collect('data_vencimento', ['VENCIMENTO', 'DATA DE VENCIMENTO'], dateValue)

  const totalsStart = comparable.indexOf('VALOR TOTAL DA NFS-E')
  const totalsEnd = comparable.indexOf('INFORMACOES COMPLEMENTARES', totalsStart + 1)
  if (totalsStart < 0 || comparable.filter(line => line === 'VALOR TOTAL DA NFS-E').length !== 1) {
    result.motivos_bloqueio.push('nfse_totals_section_ambiguous')
  } else {
    const end = totalsEnd < 0 ? lines.length : totalsEnd
    collect('valor_bruto', ['VALOR DA OPERACAO / SERVICO'], moneyValue, totalsStart, end)
    // Correspondência exata: o rótulo acrescido de IBS/CBS nunca vira líquido canônico.
    collect('valor_liquido', ['VALOR LIQUIDO DA NFS-E'], moneyValue, totalsStart, end)
    collect('total_retencoes', ['TOTAL DAS RETENCOES (ISSQN / FEDERAIS)'], moneyValue, totalsStart, end)
    collect('desconto_incondicionado', ['DESCONTO INCONDICIONADO'], moneyValue, totalsStart, end)
    collect('valor_liquido_com_ibscbs', ['VALOR LIQUIDO DA NFS-E + IBS/CBS'], moneyValue, totalsStart, end)
  }

  const { valor_bruto: gross, valor_liquido: net, total_retencoes: deductions, data_emissao: issued, data_vencimento: due } = result.dados
  if (due) result.vencimento_source = 'DOCUMENT'
  if (due && issued && due < issued) result.motivos_bloqueio.push('nfse_due_date_issue_conflict')
  if (gross !== undefined && net !== undefined && deductions !== undefined
    && Math.abs(Math.round(gross * 100) - Math.round(deductions * 100) - Math.round(net * 100)) > 1) {
    result.avisos.push('nfse_totals_arithmetic_review_required')
  }
  result.motivos_bloqueio = [...new Set(result.motivos_bloqueio)]
  return result
}

export function validateNfseExtraction(result: NfseExtraction): NfseExtractionGate {
  const required: NfseField[] = ['numero_nf', 'chave_acesso', 'cnpj_emitente', 'razao_social_emitente',
    'cnpj_destinatario', 'razao_social_destinatario', 'data_emissao', 'valor_bruto']
  const failedFields = required.filter(field => result.dados[field] === undefined
    || (result.confianca[field] ?? 0) < MIN_CRITICAL_CONFIDENCE)
  if (!(Number(result.dados.valor_bruto) > 0) && !failedFields.includes('valor_bruto')) failedFields.push('valor_bruto')
  const reasons = [...result.motivos_bloqueio, ...result.avisos]
  return result.tipo_documento === 'NFSE' && failedFields.length === 0 && reasons.length === 0
    ? { ok: true }
    : { ok: false, failedFields, reasons }
}
