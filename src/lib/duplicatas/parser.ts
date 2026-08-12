import type {
  CampoDuplicata,
  CamposDuplicata,
  EvidenciaExtracaoDuplicata,
  ExtracaoDuplicata,
} from './types'

const MAX_TEXTO_EXTRAIDO = 50_000
const CAMPOS_CRITICOS: CampoDuplicata[] = [
  'numero',
  'data_vencimento',
  'valor_nominal',
  'cnpj_cedente_documento',
  'cnpj_sacado_documento',
]

type RegraRotulo = {
  campo: CampoDuplicata
  aliases: string[]
  normalizar: (value: string) => string | number | null
  confianca: number
}

function semAcentos(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function normalizarTextoDuplicata(texto: string): string {
  return texto
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXTO_EXTRAIDO)
}

function normalizarCnpj(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  return digits.length === 14 ? digits : null
}

function normalizarData(value: string): string | null {
  const br = value.match(/\b(\d{2})[/.\-](\d{2})[/.\-](\d{4})\b/)
  if (br) {
    const [, day, month, year] = br
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`)
    return Number.isNaN(date.getTime())
      || date.getUTCFullYear() !== Number(year)
      || date.getUTCMonth() + 1 !== Number(month)
      || date.getUTCDate() !== Number(day)
      ? null
      : `${year}-${month}-${day}`
  }
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (!iso) return null
  const date = new Date(`${iso[0]}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== Number(iso[1])
    || date.getUTCMonth() + 1 !== Number(iso[2])
    || date.getUTCDate() !== Number(iso[3])
    ? null
    : iso[0]
}

function normalizarValor(value: string): number | null {
  const raw = value.replace(/R\$|BRL/gi, '').replace(/\s/g, '')
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/,(?=\d{3}(?:\D|$))/g, '')
  const number = Number(normalized.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : null
}

function normalizarIdentificador(value: string): string | null {
  const cleaned = value.trim().replace(/^[#:;\-\s]+/, '').replace(/[;|].*$/, '').trim()
  return cleaned.length > 0 && cleaned.length <= 80 ? cleaned : null
}

function normalizarTextoCurto(value: string): string | null {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, 500) : null
}

const REGRAS: RegraRotulo[] = [
  { campo: 'numero', aliases: ['numero da duplicata', 'nº da duplicata', 'n° da duplicata', 'no da duplicata', 'nº de ordem', 'n° de ordem', 'no de ordem', 'duplicata nº', 'duplicata n°', 'duplicata no', 'numero do titulo', 'titulo nº', 'titulo n°'], normalizar: normalizarIdentificador, confianca: 0.95 },
  { campo: 'numero_fatura', aliases: ['numero da fatura', 'nº da fatura', 'n° da fatura', 'no da fatura', 'fatura nº', 'fatura n°', 'fatura no'], normalizar: normalizarIdentificador, confianca: 0.94 },
  { campo: 'parcela', aliases: ['parcela', 'prestacao'], normalizar: (value) => normalizarIdentificador(value) ?? '', confianca: 0.88 },
  { campo: 'data_emissao', aliases: ['data de emissao', 'emissao'], normalizar: normalizarData, confianca: 0.92 },
  { campo: 'data_vencimento', aliases: ['data de vencimento', 'vencimento', 'vence em'], normalizar: normalizarData, confianca: 0.96 },
  { campo: 'valor_nominal', aliases: ['valor nominal', 'valor da duplicata', 'valor do titulo', 'valor total'], normalizar: normalizarValor, confianca: 0.94 },
  { campo: 'local_pagamento', aliases: ['local de pagamento', 'praca de pagamento', 'pagavel em'], normalizar: normalizarTextoCurto, confianca: 0.85 },
  { campo: 'aceite_textual', aliases: ['aceite', 'declaracao de aceite', 'aceito por'], normalizar: normalizarTextoCurto, confianca: 0.72 },
]

function linhas(texto: string): string[] {
  return texto.split('\n').map((line) => line.trim()).filter(Boolean)
}

function trecho(lines: string[], index: number): string {
  return lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 3)).join(' | ').slice(0, 300)
}

function extrairPorRotulos(texto: string): Partial<Record<CampoDuplicata, EvidenciaExtracaoDuplicata>> {
  const lines = linhas(texto)
  const normalizedLines = lines.map((line) => semAcentos(line).toLowerCase())
  const evidencias: Partial<Record<CampoDuplicata, EvidenciaExtracaoDuplicata>> = {}

  for (const rule of REGRAS) {
    for (let index = 0; index < lines.length; index += 1) {
      const normalized = normalizedLines[index]
      const alias = rule.aliases.find((candidate) => normalized.includes(semAcentos(candidate).toLowerCase()))
      if (!alias) continue
      const aliasIndex = normalized.indexOf(semAcentos(alias).toLowerCase())
      const sameLine = lines[index].slice(aliasIndex + alias.length).replace(/^\s*[:#\-–]\s*/, '').trim()
      const candidate = sameLine || lines[index + 1] || ''
      const value = rule.normalizar(candidate)
      if (value === null || value === '') continue
      evidencias[rule.campo] = {
        campo: rule.campo,
        valorOriginal: candidate.slice(0, 300),
        valorNormalizado: value,
        trechoFonte: trecho(lines, index),
        metodo: 'rotulo',
        confianca: rule.confianca,
      }
      break
    }
  }
  return evidencias
}

function extrairCnpjContextual(texto: string, aliases: string[]): EvidenciaExtracaoDuplicata | null {
  const lines = linhas(texto)
  const normalizedLines = lines.map((line) => semAcentos(line).toLowerCase())
  for (let index = 0; index < lines.length; index += 1) {
    if (!aliases.some((alias) => normalizedLines[index].includes(alias))) continue
    const block = lines.slice(index, index + 8).join(' ')
    const match = block.match(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[\s/]?\d{4}[\s-]?\d{2}/)
    const cnpj = match ? normalizarCnpj(match[0]) : null
    if (!cnpj) continue
    return {
      campo: aliases.includes('sacado') || aliases.includes('destinatario') ? 'cnpj_sacado_documento' : 'cnpj_cedente_documento',
      valorOriginal: match?.[0] ?? '',
      valorNormalizado: cnpj,
      trechoFonte: trecho(lines, index),
      metodo: 'secao',
      confianca: 0.94,
    }
  }
  return null
}

function extrairNomeContextual(
  texto: string,
  aliases: string[],
  campo: 'nome_cedente_documento' | 'nome_sacado_documento',
): EvidenciaExtracaoDuplicata | null {
  const sourceLines = linhas(texto)
  const normalizedLines = sourceLines.map((line) => semAcentos(line).toLowerCase())
  for (let index = 0; index < sourceLines.length; index += 1) {
    const alias = aliases.find((candidate) => normalizedLines[index].includes(candidate))
    if (!alias) continue
    const normalizedAliasIndex = normalizedLines[index].indexOf(alias)
    const sameLine = sourceLines[index]
      .slice(normalizedAliasIndex + alias.length)
      .replace(/^\s*(?:nome|razao social)?\s*[:#\-–]?\s*/i, '')
      .replace(/\b(?:CPF\/CNPJ|CNPJ)\b.*$/i, '')
      .trim()
    const nextLine = (sourceLines[index + 1] || '').replace(/\b(?:CPF\/CNPJ|CNPJ)\b.*$/i, '').trim()
    const candidate = sameLine || nextLine
    if (candidate.length < 3 || !/[A-Za-zÀ-ÿ]/.test(candidate) || /^\d/.test(candidate)) continue
    const normalizedName = candidate.replace(/\s+/g, ' ').slice(0, 300)
    return {
      campo,
      valorOriginal: candidate.slice(0, 300),
      valorNormalizado: normalizedName,
      trechoFonte: trecho(sourceLines, index),
      metodo: 'secao',
      confianca: 0.78,
    }
  }
  return null
}

function extrairDuplicataEstrutural(texto: string): Partial<Record<CampoDuplicata, EvidenciaExtracaoDuplicata>> {
  const evidencias: Partial<Record<CampoDuplicata, EvidenciaExtracaoDuplicata>> = {}
  const titleRow = texto.match(/\b([A-Z0-9][A-Z0-9./-]{2,40})\s+(\d{2}[/.\-]\d{2}[/.\-]\d{4})\s+(?:R\$\s*)?([\d.]+,\d{2})\b/i)
  if (titleRow) {
    const numero = normalizarIdentificador(titleRow[1])
    const vencimento = normalizarData(titleRow[2])
    const valor = normalizarValor(titleRow[3])
    const snippet = titleRow[0].slice(0, 300)
    if (numero) evidencias.numero = { campo: 'numero', valorOriginal: titleRow[1], valorNormalizado: numero, trechoFonte: snippet, metodo: 'padrao_estrutural', confianca: 0.78 }
    if (vencimento) evidencias.data_vencimento = { campo: 'data_vencimento', valorOriginal: titleRow[2], valorNormalizado: vencimento, trechoFonte: snippet, metodo: 'padrao_estrutural', confianca: 0.82 }
    if (valor) evidencias.valor_nominal = { campo: 'valor_nominal', valorOriginal: titleRow[3], valorNormalizado: valor, trechoFonte: snippet, metodo: 'padrao_estrutural', confianca: 0.8 }
  }
  return evidencias
}

function camposDasEvidencias(evidencias: Partial<Record<CampoDuplicata, EvidenciaExtracaoDuplicata>>): CamposDuplicata {
  const value = <T extends string | number>(field: CampoDuplicata): T | null => {
    const extracted = evidencias[field]?.valorNormalizado
    return extracted === null || extracted === undefined ? null : extracted as T
  }
  return {
    numero: value<string>('numero'),
    numero_fatura: value<string>('numero_fatura'),
    parcela: value<string>('parcela') ?? '',
    data_emissao: value<string>('data_emissao'),
    data_vencimento: value<string>('data_vencimento'),
    valor_nominal: value<number>('valor_nominal'),
    nome_cedente_documento: value<string>('nome_cedente_documento'),
    cnpj_cedente_documento: value<string>('cnpj_cedente_documento'),
    nome_sacado_documento: value<string>('nome_sacado_documento'),
    cnpj_sacado_documento: value<string>('cnpj_sacado_documento'),
    local_pagamento: value<string>('local_pagamento'),
    aceite_textual: value<string>('aceite_textual'),
    aceite_detectado_textualmente: value<'SIM' | 'NAO' | 'INDETERMINADO'>('aceite_detectado_textualmente') ?? 'INDETERMINADO',
  }
}

export function extrairDuplicataDeTexto(rawText: string): ExtracaoDuplicata {
  const texto = normalizarTextoDuplicata(rawText)
  if (texto.replace(/\s/g, '').length < 50) {
    return {
      campos: camposDasEvidencias({}),
      evidencias: {},
      confiancaGeral: 0,
      camposCriticosPendentes: [...CAMPOS_CRITICOS],
      metodo: 'MANUAL',
      textoExtraido: texto || null,
    }
  }

  const rotulos = extrairPorRotulos(texto)
  const estrutural = extrairDuplicataEstrutural(texto)
  const cedente = extrairCnpjContextual(texto, ['cedente', 'sacador', 'emitente'])
  const sacado = extrairCnpjContextual(texto, ['sacado', 'destinatario', 'devedor'])
  const nomeCedente = extrairNomeContextual(texto, ['cedente', 'sacador', 'emitente'], 'nome_cedente_documento')
  const nomeSacado = extrairNomeContextual(texto, ['sacado', 'destinatario', 'devedor'], 'nome_sacado_documento')
  const evidencias = { ...estrutural, ...rotulos }
  if (nomeCedente) evidencias.nome_cedente_documento = nomeCedente
  if (cedente) evidencias.cnpj_cedente_documento = { ...cedente, campo: 'cnpj_cedente_documento' }
  if (nomeSacado) evidencias.nome_sacado_documento = nomeSacado
  if (sacado) evidencias.cnpj_sacado_documento = { ...sacado, campo: 'cnpj_sacado_documento' }
  if (evidencias.aceite_textual) {
    const original = String(evidencias.aceite_textual.valorOriginal)
    const detected = /\b(?:nao|não|sem)\b/i.test(original) ? 'NAO' : 'SIM'
    evidencias.aceite_detectado_textualmente = {
      campo: 'aceite_detectado_textualmente',
      valorOriginal: original,
      valorNormalizado: detected,
      trechoFonte: evidencias.aceite_textual.trechoFonte,
      metodo: evidencias.aceite_textual.metodo,
      confianca: evidencias.aceite_textual.confianca,
    }
  }
  if (!evidencias.parcela && typeof evidencias.numero?.valorNormalizado === 'string') {
    const parcela = evidencias.numero.valorNormalizado.match(/\/(\d{1,10})$/)?.[1]
    if (parcela) {
      evidencias.parcela = {
        campo: 'parcela',
        valorOriginal: parcela,
        valorNormalizado: parcela,
        trechoFonte: evidencias.numero.trechoFonte,
        metodo: 'padrao_estrutural',
        confianca: 0.9,
      }
    }
  }

  const campos = camposDasEvidencias(evidencias)
  const camposCriticosPendentes = CAMPOS_CRITICOS.filter((field) => {
    const evidence = evidencias[field]
    return !evidence || evidence.confianca < 0.75
  })
  const confidences = Object.values(evidencias).map((item) => item?.confianca ?? 0)
  const confiancaGeral = confidences.length
    ? Math.round((confidences.reduce((sum, current) => sum + current, 0) / confidences.length) * 10_000) / 10_000
    : 0

  return {
    campos,
    evidencias,
    confiancaGeral,
    camposCriticosPendentes,
    metodo: camposCriticosPendentes.length === 0 ? 'AUTOMATICA' : 'MANUAL',
    textoExtraido: texto,
  }
}
