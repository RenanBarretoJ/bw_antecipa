import Decimal from 'decimal.js'
import { createHash } from 'node:crypto'
import { parse } from 'csv-parse/sync'
import { RLX_LAYOUTS, type RlxFieldDefinition } from './layouts'
import type { LinhaFinanceiraProcessada, ResultadoParseFinanceiro, TipoBaseFinanceiro } from './types'

const normalizeHeader = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
const normalizeText = (value: string) => value.trim()
const normalizeDocument = (value: string) => value.replace(/\D/g, '')

function decodeArquivo(buffer: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buffer).replace(/^\uFEFF/, ''), encoding: 'windows-1252' }
  }
}

function normalizeDate(value: string): string {
  const clean = value.trim()
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const localMatch = clean.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/)
  if (!isoMatch && !localMatch) throw new Error('data invalida')
  const iso = isoMatch
    ? `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
    : `${localMatch![3]}-${localMatch![2]}-${localMatch![1]}`
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso) throw new Error('data invalida')
  return iso
}

function normalizeDateTime(value: string): string {
  const clean = value.trim()
  const date = new Date(clean)
  if (Number.isNaN(date.valueOf())) throw new Error('data e hora invalidas')
  return date.toISOString()
}

export function normalizeDecimal(value: string): string {
  const clean = value.trim().replace(/\s/g, '')
  if (!/^[+-]?[0-9.,]+$/.test(clean)) throw new Error('decimal invalido')
  const sign = clean.startsWith('-') || clean.startsWith('+') ? clean[0] : ''
  const unsigned = sign ? clean.slice(1) : clean
  const commaCount = (unsigned.match(/,/g) || []).length
  const dotCount = (unsigned.match(/\./g) || []).length
  let normalized = unsigned

  if (commaCount && dotCount) {
    const decimalSeparator = unsigned.lastIndexOf(',') > unsigned.lastIndexOf('.') ? ',' : '.'
    const groupSeparator = decimalSeparator === ',' ? '.' : ','
    const parts = unsigned.split(decimalSeparator)
    if (parts.length !== 2 || !/^\d{1,3}(?:[.,]\d{3})*$/.test(parts[0]) || !/^\d+$/.test(parts[1])) throw new Error('formato decimal ambiguo')
    normalized = `${parts[0].split(groupSeparator).join('')}.${parts[1]}`
  } else if (commaCount || dotCount) {
    const separator = commaCount ? ',' : '.'
    const count = commaCount || dotCount
    if (count > 1) {
      if (!new RegExp(`^\\d{1,3}(?:\\${separator}\\d{3})+$`).test(unsigned)) throw new Error('formato decimal ambiguo')
      normalized = unsigned.split(separator).join('')
    } else {
      const [integer, decimals] = unsigned.split(separator)
      if (!integer || !decimals) throw new Error('decimal invalido')
      if (decimals.length === 3) throw new Error('formato decimal ambiguo')
      normalized = `${integer}.${decimals}`
    }
  }
  normalized = `${sign}${normalized}`
  const decimal = new Decimal(normalized)
  if (!decimal.isFinite()) throw new Error('decimal invalido')
  return decimal.toFixed(4)
}

function documentChecksumValid(value: string): boolean {
  if (value.length === 11) {
    if (/^(\d)\1+$/.test(value)) return false
    const digit = (base: string, factor: number) => {
      const total = [...base].reduce((sum, item) => sum + Number(item) * factor--, 0)
      const result = (total * 10) % 11
      return result === 10 ? 0 : result
    }
    return digit(value.slice(0, 9), 10) === Number(value[9]) && digit(value.slice(0, 10), 11) === Number(value[10])
  }
  if (value.length === 14) {
    if (/^(\d)\1+$/.test(value)) return false
    const digit = (base: string, weights: number[]) => {
      const total = [...base].reduce((sum, item, index) => sum + Number(item) * weights[index], 0)
      const remainder = total % 11
      return remainder < 2 ? 0 : 11 - remainder
    }
    const first = digit(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return first === Number(value[12]) && digit(value.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(value[13])
  }
  return false
}

function stableFingerprint(parts: Array<string | undefined>) {
  return createHash('sha256').update(parts.map((value) => value || '').join('|')).digest('hex')
}

function normalizeField(value: string, definition: RlxFieldDefinition): string {
  if (!value.trim()) return ''
  if (definition.kind === 'document') return normalizeDocument(value)
  if (definition.kind === 'date') return normalizeDate(value)
  if (definition.kind === 'datetime') return normalizeDateTime(value)
  if (definition.kind === 'decimal') return normalizeDecimal(value)
  return normalizeText(value)
}

function resolveHeader(headers: string[], aliases: string[]): string | null {
  const normalizedAliases = aliases.map(normalizeHeader)
  return headers.find((header) => normalizedAliases.includes(normalizeHeader(header))) ?? null
}

export function processarArquivoRlx(input: {
  arquivo: Uint8Array
  tipoBase: TipoBaseFinanceiro
  fundoId: string
  dataReferencia: string
  provedor?: string
  maxRows?: number
  maxParseMs?: number
}): ResultadoParseFinanceiro {
  const startedAt = performance.now()
  const maxParseMs = input.maxParseMs ?? Number(process.env.FINANCEIRO_MAX_PARSE_MS || process.env.RLX_MAX_PARSE_MS || 20_000)
  if (!Number.isSafeInteger(maxParseMs) || maxParseMs < 1 || maxParseMs > 120_000) throw new Error('Timeout do parser invalido.')
  const assertWithinDeadline = () => {
    if (performance.now() - startedAt > maxParseMs) throw new Error(`Parser excedeu o limite de ${maxParseMs} ms.`)
  }
  const decoded = decodeArquivo(input.arquivo)
  const records = parse(decoded.text, {
    bom: true,
    columns: true,
    delimiter: ';',
    skip_empty_lines: true,
    trim: true,
    relax_quotes: false,
    relax_column_count: false,
  }) as Array<Record<string, string>>
  assertWithinDeadline()
  const maxRows = input.maxRows ?? Number(process.env.FINANCEIRO_MAX_IMPORT_ROWS || process.env.RLX_MAX_IMPORT_ROWS || 100_000)
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) throw new Error('Limite de linhas invalido.')
  if (records.length > maxRows) throw new Error(`Arquivo excede o limite de ${maxRows} linhas.`)
  const layout = RLX_LAYOUTS[input.tipoBase]
  const layoutNome = `${input.tipoBase}_GOLDEN_V1`
  const headers = records.length ? Object.keys(records[0]) : decoded.text.split(/\r?\n/, 1)[0]?.split(';') ?? []
  const statusHeader = resolveHeader(headers, ['STATUS_ARQUIVO'])
  const isExplicitEmpty = records.length === 1 && statusHeader && normalizeHeader(records[0][statusHeader] || '') === 'SEM_MOVIMENTO'

  if (isExplicitEmpty) {
    const errosArquivo = layout.permitsExplicitEmpty ? [] : [`${input.tipoBase} nao permite declaracao de movimento vazio.`]
    return {
      tipoBase: input.tipoBase,
      layoutNome,
      versaoLayout: 'RLX_V1',
      encoding: decoded.encoding,
      completude: errosArquivo.length ? 'INCOMPLETO' : 'COMPLETO_VAZIO',
      linhas: [],
      errosArquivo,
      valorTotal: '0.0000',
    }
  }

  const headerMap = Object.fromEntries(Object.entries(layout.fields).map(([fieldName, definition]) => [fieldName, resolveHeader(headers, definition.aliases)]))
  const missingHeaders = Object.entries(layout.fields)
    .filter(([fieldName, definition]) => definition.required && !headerMap[fieldName])
    .map(([fieldName]) => `Cabecalho obrigatorio ausente: ${fieldName}.`)

  const linhas: LinhaFinanceiraProcessada[] = records.map((record, index) => {
    if (index % 1_000 === 0) assertWithinDeadline()
    const erros: string[] = []
    const avisos: string[] = []
    // O UUID interno do fundo vem do contexto autenticado/versionado da
    // integracao. Relatorios externos podem trazer somente DOC_FUNDO ou
    // ID_FUNDO, que nao sao equivalentes ao nosso identificador interno.
    const normalized: Record<string, string> = { fundo_id: input.fundoId }
    for (const [fieldName, definition] of Object.entries(layout.fields)) {
      const header = headerMap[fieldName]
      const rawValue = header ? String(record[header] ?? '') : ''
      if (definition.required && !rawValue.trim()) {
        erros.push(`${fieldName}: valor obrigatorio ausente.`)
        continue
      }
      try {
        const value = normalizeField(rawValue, definition)
        if (fieldName === 'fundo_id' && value && value !== input.fundoId) {
          erros.push('fundo_id: arquivo pertence a outro fundo.')
        } else if (fieldName !== 'fundo_id' || value) {
          normalized[fieldName] = value
        }
      } catch (error) {
        erros.push(`${fieldName}: ${error instanceof Error ? error.message : 'valor invalido'}.`)
      }
    }
    const rowReference = normalized.data_referencia || normalized.data_movimento
    if (rowReference && rowReference !== input.dataReferencia) erros.push('data_referencia: divergente da importacao.')
    for (const key of ['cedente_documento', 'sacado_documento', 'documento_fundo']) {
      if (normalized[key] && ![11, 14].includes(normalized[key].length)) avisos.push(`${key}: quantidade de digitos atipica.`)
      else if (normalized[key] && !documentChecksumValid(normalized[key])) avisos.push(`${key}: checksum CPF/CNPJ invalido.`)
    }
    const namespace = (input.provedor || 'nao_informado').toLowerCase()
    if (!erros.length && input.tipoBase === 'ESTOQUE') {
      normalized.external_title_key = stableFingerprint([input.fundoId, namespace, 'RLX_TITLE_V1', normalized.id_recebivel, normalized.seu_numero, normalized.numero_documento])
    }
    if (!erros.length && input.tipoBase === 'AQUISICOES') {
      normalized.fingerprint_versao = 'RLX_FP_V1'
      normalized.fingerprint_linha = stableFingerprint([input.fundoId, namespace, normalized.fingerprint_versao, normalized.id_recebivel, normalized.data_movimento, normalized.valor_compra, String(index + 2)])
    }
    if (!erros.length && input.tipoBase === 'LIQUIDACOES') {
      normalized.fingerprint_versao = 'RLX_FP_V1'
      normalized.fingerprint_linha = stableFingerprint([input.fundoId, namespace, normalized.fingerprint_versao, normalized.id_recebivel, normalized.data_movimento, normalized.valor_pago, normalized.id_tipo_movimento, String(index + 2)])
    }
    return {
      numeroLinha: index + 2,
      status: erros.length ? 'INVALIDA' : avisos.length ? 'WARNING' : 'VALIDA',
      dadosBrutos: Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value ?? '')])),
      dadosNormalizados: normalized,
      erros,
      avisos,
    }
  })

  const total = linhas.filter((row) => row.status !== 'INVALIDA').reduce((sum, row) => {
    const value = row.dadosNormalizados[layout.totalField]
    return value ? sum.plus(value) : sum
  }, new Decimal(0))
  const errosArquivo = [...missingHeaders]
  if (!records.length) errosArquivo.push('Arquivo sem linhas de dados e sem declaracao explicita de movimento vazio.')

  return {
    tipoBase: input.tipoBase,
    layoutNome,
    versaoLayout: 'RLX_V1',
    encoding: decoded.encoding,
    completude: errosArquivo.length || linhas.some((row) => row.status === 'INVALIDA') ? 'INCOMPLETO' : 'COMPLETO_COM_DADOS',
    linhas,
    errosArquivo,
    valorTotal: total.toFixed(4),
  }
}
