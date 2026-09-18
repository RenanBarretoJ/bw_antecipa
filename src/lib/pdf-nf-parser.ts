import { resolveDanfeValue, type DanfeLayout, type ValorSource } from './danfe/valor'

// pdf-parse está em serverExternalPackages (next.config.ts): o Next.js usa o require
// nativo do Node.js, evitando o problema do index.js tentar ler arquivo de teste ao ser bundlado.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>

export type DanfeCriticalField = 'numero_nf' | 'serie' | 'chave_acesso' | 'cnpj_emitente' | 'cnpj_destinatario' | 'data_emissao' | 'data_vencimento' | 'valor_bruto'

export interface DanfeFieldCandidate {
  field: DanfeCriticalField
  value: string | number
  source: string
  anchor: string
  confidence: number
  rawText?: string
  corroboratedBy: string[]
}

const MIN_CRITICAL_CONFIDENCE = 0.85

function normalizeDanfeText(text: string): string {
  return text.normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

function validNfeKey(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false
  let sum = 0
  let weight = 2
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(key[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const remainder = sum % 11
  return Number(key[43]) === (remainder < 2 ? 0 : 11 - remainder)
}

export interface NfPdfExtracted {
  numero_nf?: string
  serie?: string
  chave_acesso?: string
  cnpj_emitente?: string
  data_emissao?: string       // YYYY-MM-DD
  data_vencimento?: string    // YYYY-MM-DD
  // A identidade do emitente vem da chave fiscal validada; o cadastro autorizado
  // continua sendo resolvido no servidor antes de qualquer persistencia.
  cnpj_destinatario?: string  // só dígitos
  razao_social_destinatario?: string
  valor_bruto?: number   // Valor total canonico da NF
  valor_liquido?: number // Valor total da NF (sem desconto financeiro)
  origem_valor_bruto?: 'valor_total_nota' | 'valor_total_produtos' | 'duplicata_soma' | 'valor_original' | 'valor_liquido'
  condicao_pagamento?: string
  layout_fingerprint?: DanfeLayout
  candidatos?: Partial<Record<DanfeCriticalField, DanfeFieldCandidate[]>>
  confianca?: Partial<Record<DanfeCriticalField, number>>
  proveniencia?: Partial<Record<DanfeCriticalField, { source: string; corroboratedBy: string[] }>>
  motivos_bloqueio?: string[]
  strategies?: ValorSource[]
  timings_ms?: { extraction: number; parsing: number }
  descricao_itens?: string    // conteúdo de "INFORMAÇÕES COMPLEMENTARES"
  campos_extraidos: string[]  // lista dos campos extraídos com sucesso
}

/**
 * Tenta extrair dados de um DANFE (NF-e) em PDF.
 * Funciona apenas para PDFs com texto embedado (não escaneados).
 * Em caso de falha total, retorna { campos_extraidos: [] }.
 */
export async function extractDanfeFromPdf(buffer: Buffer): Promise<NfPdfExtracted> {
  let text = ''
  const started = performance.now()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    // Timeout de 20s: em ambientes serverless o PDF.js pode travar sem rejeitar
    // Alguns PDFs textuais validos fazem o pdf-parse falhar transitoriamente na
    // primeira leitura; duas novas tentativas sao limitadas pelo mesmo timeout.
    const parseWithRetry = async (): Promise<{ text: string }> => {
      let lastError: unknown
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try { return await pdfParse(Buffer.from(buffer)) }
        catch (error) { lastError = error }
      }
      throw lastError
    }
    const result = await Promise.race([
      parseWithRetry(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('pdf-parse timeout')), 20000)
      }),
    ])
    text = result.text || ''
  } catch {
    return { campos_extraidos: [], motivos_bloqueio: ['pdf_text_extraction_failed'], timings_ms: { extraction: Math.round(performance.now() - started), parsing: 0 } }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }

  // PDF escaneado (imagem) — texto insuficiente para extração
  if (text.replace(/\s/g, '').length < 50) {
    return { campos_extraidos: [], motivos_bloqueio: ['pdf_without_readable_text'], timings_ms: { extraction: Math.round(performance.now() - started), parsing: 0 } }
  }

  // Normalizar: múltiplos espaços → um espaço, manter case original para regex case-insensitive
  const extractedAt = performance.now()
  const parsed = extractDanfeFromText(text)
  parsed.timings_ms = { extraction: Math.round(extractedAt - started), parsing: Math.round(performance.now() - extractedAt) }
  return parsed
}

export function extractDanfeFromText(input: string): NfPdfExtracted {
  const normalized = normalizeDanfeText(input)
  const campos_extraidos: string[] = []
  const candidatos: Partial<Record<DanfeCriticalField, DanfeFieldCandidate[]>> = {}
  const confianca: Partial<Record<DanfeCriticalField, number>> = {}
  const proveniencia: Partial<Record<DanfeCriticalField, { source: string; corroboratedBy: string[] }>> = {}
  const extracted: NfPdfExtracted = { campos_extraidos, candidatos, confianca, proveniencia, motivos_bloqueio: [] }
  const record = (field: DanfeCriticalField, value: string | number, source: string, confidence: number, corroboratedBy: string[] = [], rawText?: string) => {
    const item: DanfeFieldCandidate = { field, value, source, anchor: source, confidence, corroboratedBy, ...(rawText ? { rawText } : {}) }
    candidatos[field] = [...(candidatos[field] || []), item]
    if (confidence > (confianca[field] || 0)) {
      confianca[field] = confidence
      proveniencia[field] = { source, corroboratedBy }
    }
  }

  const chaveLida = extractChaveAcesso(normalized)
  const chave = chaveLida && validNfeKey(chaveLida) ? chaveLida : undefined
  if (chaveLida && !chave) extracted.motivos_bloqueio?.push('invalid_access_key')
  const numeroCabecalho = extractNumeroNF(normalized)
  const numero = chave ? String(Number(chave.slice(25, 34))) : numeroCabecalho
  if (chave && numeroCabecalho && Number(numeroCabecalho) !== Number(numero)) extracted.motivos_bloqueio?.push('invoice_key_conflict')
  if (numero) { extracted.numero_nf = numero; campos_extraidos.push('numero_nf'); record('numero_nf', numero, chave ? 'chave_acesso' : 'cabecalho_nf', chave ? 0.99 : 0.86) }

  const serieCabecalho = extractSerie(normalized)
  const serie = chave ? String(Number(chave.slice(22, 25))) : serieCabecalho
  if (chave && serieCabecalho && Number(serieCabecalho) !== Number(serie)) extracted.motivos_bloqueio?.push('series_key_conflict')
  if (serie) { extracted.serie = serie; campos_extraidos.push('serie'); record('serie', serie, chave ? 'chave_acesso' : 'cabecalho_serie', chave ? 0.99 : 0.82) }

  if (chave) {
    extracted.chave_acesso = chave
    extracted.cnpj_emitente = chave.slice(6, 20)
    campos_extraidos.push('chave_acesso', 'cnpj_emitente')
    record('chave_acesso', chave, 'chave_44_digitos_dv', 0.99)
    record('cnpj_emitente', extracted.cnpj_emitente, 'chave_acesso', 0.99)
  }
  const cnpjEmitenteTextual = extractCnpjEmitenteContextual(normalized)
  if (cnpjEmitenteTextual) {
    record('cnpj_emitente', cnpjEmitenteTextual, 'identificacao_emitente', 0.88)
    if (extracted.cnpj_emitente && extracted.cnpj_emitente !== cnpjEmitenteTextual) {
      extracted.motivos_bloqueio?.push('issuer_key_conflict')
    } else if (!extracted.cnpj_emitente) {
      extracted.cnpj_emitente = cnpjEmitenteTextual
      campos_extraidos.push('cnpj_emitente')
    } else {
      proveniencia.cnpj_emitente = { source: 'chave_acesso', corroboratedBy: ['identificacao_emitente'] }
    }
  }

  const dataEmissao = extractDataEmissao(normalized)
  if (dataEmissao) { extracted.data_emissao = dataEmissao; campos_extraidos.push('data_emissao'); record('data_emissao', dataEmissao, 'rotulo_emissao', 0.90) }

  const dataVencimento = extractDataVencimento(normalized)
  if (dataVencimento) { extracted.data_vencimento = dataVencimento; campos_extraidos.push('data_vencimento'); record('data_vencimento', dataVencimento, 'rotulo_ou_duplicata', 0.88) }

  const { destinatario: cnpjDest } = extractCnpjs(normalized)
  if (cnpjDest) { extracted.cnpj_destinatario = cnpjDest; campos_extraidos.push('cnpj_destinatario'); record('cnpj_destinatario', cnpjDest, 'secao_destinatario', 0.88) }

  const razaoDest = extractRazaoSocialDestinatario(normalized)
  if (razaoDest) { extracted.razao_social_destinatario = razaoDest; campos_extraidos.push('razao_social_destinatario') }

  const valor = resolveDanfeValue(normalized, numero)
  extracted.layout_fingerprint = valor.layout
  extracted.strategies = valor.strategies
  extracted.motivos_bloqueio?.push(...valor.reasons)
  for (const item of valor.candidates) record('valor_bruto', item.value, item.source, item.confidence, item.corroboratedBy, item.rawText)
  if (valor.selected) {
    extracted.valor_bruto = valor.selected.value
    extracted.valor_liquido = valor.selected.value
    extracted.origem_valor_bruto = valor.selected.source === 'VALOR_TOTAL_DOS_PRODUTOS' ? 'valor_total_produtos'
      : valor.selected.source === 'DUPLICATA_SUM' ? 'duplicata_soma'
        : valor.selected.source === 'VALOR_ORIGINAL' ? 'valor_original'
          : valor.selected.source === 'VALOR_LIQUIDO' ? 'valor_liquido' : 'valor_total_nota'
    confianca.valor_bruto = valor.confidence
    proveniencia.valor_bruto = { source: valor.selected.source, corroboratedBy: valor.selected.corroboratedBy }
    campos_extraidos.push('valor_bruto', 'valor_liquido')
  }

  const condicao = extractCondicaoPagamento(normalized)
  if (condicao) { extracted.condicao_pagamento = condicao; campos_extraidos.push('condicao_pagamento') }

  const descricao = extractInformacoesComplementares(normalized)
  if (descricao) { extracted.descricao_itens = descricao; campos_extraidos.push('descricao_itens') }

  return extracted
}

// ─── Extratores individuais ──────────────────────────────────────────────────

function extractNumeroNF(text: string): string | undefined {
  const patterns = [
    // "NF-e\nNº. 000.006.942" — cabeçalho do DANFE (mais confiável)
    /NF-?e[\s\n]+N\.?[°º]\.?\s*(\d[\d.]{0,11})/i,
    // "Nº. 000.006.942" no início de linha
    /^N\.?[°º]\.?\s+(\d[\d.]{0,11})/im,
    // "ELETRÔNICA Nº 9.700" — banner de rodapé (MD SAUDE, BIOREGENERA)
    /ELETR[ÔO]NICA\s+N[°º]\.?\s*(\d[\d.,]{0,11})/i,
    /N[°º]\s+DA\s+NOTA\s*[:\-]?\s*(\d[\d.]{0,11})/i,
    /NOTA\s+FISCAL\s+N[°º\.]+\s*(\d[\d.]{0,11})/i,
    // "N.º\nSÉRIE\n33850" — layout de bloco (Vida Saúde e similares): N então ponto então º
    /N\.[°º]\s*\n\s*S[ÉE]R[^\n]*\n\s*(\d+)/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return m[1].replace(/[.,]/g, '')
  }
  return undefined
}

function extractSerie(text: string): string | undefined {
  const m = text.match(/S[ÉE]R(?:IE|\.)\s*[:\-]?\s*(\d{1,3})(?!\d)/i)
  return m?.[1] ?? undefined
}

function extractChaveAcesso(text: string): string | undefined {
  // Chave de acesso: 44 dígitos com separadores espaço ou ponto (ex: VIDA SAUDE usa pontos)
  const m = text.match(/(\d[\d. ]{50,65}\d)/)
  if (m?.[1]) {
    const digits = m[1].replace(/\D/g, '')
    if (digits.length === 44) return digits
  }
  // Tentativa direta: 44 dígitos sem separação
  const m2 = text.match(/\b(\d{44})\b/)
  return m2?.[1] ?? undefined
}

function extractDataEmissao(text: string): string | undefined {
  const patterns = [
    /EMISS[ÃA]O\s*:\s*(\d{2}[-/]\d{2}[-/]\d{4})/i,
    /DATA\s+(?:DE\s+)?EMISS[ÃA]O\s*[:\-\/]?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /EMISS[ÃA]O\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
    // data aparece em linha de dados abaixo do cabeçalho de coluna (Vida Saúde e similares)
    /DATA\s+DA\s+EMISS[ÃA]O[\s\S]{0,600}?(\d{2}\/\d{2}\/\d{4})/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return parseBRDate(m[1])
  }
  return undefined
}

function extractDataVencimento(text: string): string | undefined {
  // Campo explícito de vencimento
  const explicitPatterns = [
    /DUPLICATAS[\s\S]{0,100}?(\d{2}[-/]\d{2}[-/]\d{4})/i,
    /DATA\s+(?:DE\s+)?VENCIMENTO\s*[:\-\/]?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /VENCIMENTO\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
    // "PARCELAS 001 15/04/2026 16.661,60" — MD SAUDE, BIOREGENERA
    /PARCELAS\s+\d+\s+(\d{2}\/\d{2}\/\d{4})/i,
  ]
  for (const re of explicitPatterns) {
    const m = text.match(re)
    if (m?.[1]) return parseBRDate(m[1])
  }

  // Linha de duplicata: "{numero} {DD/MM/AAAA} {valor}" — VIDA SAUDE e formatos similares
  // Ex: "34946-01/01 11/03/2026 9800.00" ou "001 11/03/2026 9800,00"
  const duplicataMatches = [...text.matchAll(/\b\d[\d\-\/]*\s+(\d{2}\/\d{2}\/\d{4})\s+[\d.,]+/g)]
  if (duplicataMatches.length > 0) {
    // Pegar o último (vencimento mais distante quando há múltiplas parcelas)
    const ultimo = duplicataMatches[duplicataMatches.length - 1]
    if (ultimo[1]) return parseBRDate(ultimo[1])
  }

  // Fallback: qualquer data dentro do bloco FATURA/DUPLICATA
  const faturaIdx = text.search(/FATURA\s*[\/\s]*DUPLICATA/i)
  if (faturaIdx >= 0) {
    const bloco = text.substring(Math.max(0, faturaIdx - 200), faturaIdx + 400)
    const datas = [...bloco.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)]
    if (datas.length > 0) return parseBRDate(datas[datas.length - 1][1])
  }

  return undefined
}

function extractCnpjs(text: string): { destinatario?: string } {
  const cnpjRe = /(\d{2}[\.\s]?\d{3}[\.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2})/g

  // Preferir a seção "DESTINATÁRIO / REMETENTE" (cabeçalho da tabela, não o banner)
  // O banner usa "DESTINATÁRIO: ..." e está antes do bloco real da tabela
  const destSectionIdx = text.search(/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i)
  if (destSectionIdx >= 0) {
    const bloco = text.substring(destSectionIdx, destSectionIdx + 1500)
    for (const m of bloco.matchAll(cnpjRe)) {
      const digits = m[1].replace(/\D/g, '')
      if (digits.length === 14) return { destinatario: digits }
    }
  }

  // Fallback: coletar todos os CNPJs únicos — destinatário é o segundo (emitente vem primeiro)
  const unique = [...new Set(
    [...text.matchAll(cnpjRe)]
      .map(m => m[1].replace(/\D/g, ''))
      .filter(d => d.length === 14)
  )]
  if (unique.length >= 2) return { destinatario: unique[1] }

  return {}
}

function extractRazaoSocialDestinatario(text: string): string | undefined {
  // 1. Banner de rodapé: "DESTINATÁRIO: NOME DA EMPRESA - Endereço"
  //    Presente em MD SAUDE, BIOREGENERA e LW MED (começa com "RECEBEMOS DE...")
  const bannerMatch = text.match(/DESTINAT[ÁA]R[^\n:]{0,10}:\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][^-\n]{3,80})/i)
  if (bannerMatch?.[1]) return bannerMatch[1].trim().substring(0, 80)

  // 2. Dentro do bloco DESTINATÁRIO da tabela — tenta "DESTINATÁRIO / REMETENTE" primeiro,
  //    depois qualquer seção "DESTINATÁRIO"
  const destIdx =
    text.search(/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i) >= 0
      ? text.search(/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i)
      : text.search(/\bDESTINAT[ÁA]R[IO]+\b/i)

  if (destIdx < 0) return undefined

  const bloco = text.substring(destIdx, destIdx + 800)

  // 2a. Linha de dados da tabela: nome da empresa na mesma linha do CNPJ
  //     Ex: "INSTITUTO NACIONAL DE TECNOLOGIA E SAUDE 11.344.038/0021-41 09/02/2026"
  //     Captura tudo antes do padrão nn.nnn.nnn (início de CNPJ)
  const cnpjLineMatch = bloco.match(
    /([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇA-Z0-9 ]{5,60})\s+\d{2}[.\s]\d{3}[.\s]\d{3}/i
  )
  if (cnpjLineMatch?.[1]) {
    const candidate = cnpjLineMatch[1].trim()
    // Rejeitar se for um cabeçalho de coluna (contém palavras reservadas de rótulo)
    if (!/\b(RAZAO|RAZÃO|NOME|SOCIAL|CNPJ|CPF|DATA|ENDERE)\b/i.test(candidate)) {
      return candidate.substring(0, 80)
    }
  }

  // 2b. "NOME / RAZÃO SOCIAL" seguido do nome (pode ter cabeçalhos de coluna no meio)
  const nomeMatch = bloco.match(
    /NOME\s*\/\s*RAZ[ÃA]O\s+SOCIAL[\s\S]{0,120}?\n([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇA-Z0-9 ]{5,60})\s/i
  )
  if (nomeMatch?.[1]) return nomeMatch[1].trim().substring(0, 80)

  return undefined
}

function extractCnpjEmitenteContextual(text: string): string | undefined {
  const start = text.search(/IDENTIFICA[ÇC][ÃA]O\s+DO\s+EMITENTE|DADOS\s+DO\s+EMITENTE/i)
  if (start < 0) return undefined
  const destination = text.slice(start).search(/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i)
  const block = text.slice(start, start + Math.min(destination > 0 ? destination : 1500, 1500))
  const matches = [...block.matchAll(/\b(\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2})\b/g)]
    .map((match) => match[1].replace(/\D/g, ''))
  const unique = [...new Set(matches)]
  return unique.length === 1 ? unique[0] : undefined
}

function extractCondicaoPagamento(text: string): string | undefined {
  const patterns = [
    // "FORMA DE PAGAMENTO\nPAGAMENTO A PRAZO" — captura apenas até fim de linha (sem \n no grupo)
    /FORMA\s+(?:DE\s+)?PAGAMENTO\s*[:\-]?\s*([A-Za-záàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-Za-záàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ ]{2,40})/i,
    // "PAGAMENTO POR TRANSFERÊNCIA BANCÁRIA"
    /PAGAMENTO\s+POR\s+([A-Za-záàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-Za-záàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ ]{2,40})/i,
    // "PRAZO DE PAGAMENTO: 30 DIAS A PARTIR DA EMISSÃO"
    /PRAZO\s+DE\s+PAGAMENTO\s*:\s*([^\n]{3,60})/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return m[1].trim().substring(0, 60)
  }
  return undefined
}

function extractInformacoesComplementares(text: string): string | undefined {
  // Captura todo o conteúdo após "INFORMAÇÕES COMPLEMENTARES" até a próxima seção
  const m = text.match(/INFORMA[ÇC][ÕO]ES\s+COMPLEMENTARES\s*\n([\s\S]{10,2000}?)(?=\nRESERVADO|\nDADOS ADICIONAIS|\nIMPRESSO|\nFOLHA|\z)/i)
  if (m?.[1]) return m[1].replace(/\s+/g, ' ').trim().substring(0, 1000)
  // Fallback: qualquer coisa depois do label sem delimitador final
  const m2 = text.match(/INFORMA[ÇC][ÕO]ES\s+COMPLEMENTARES\s*\n([\s\S]{10,1000})/i)
  if (m2?.[1]) return m2[1].replace(/\s+/g, ' ').trim().substring(0, 1000)
  return undefined
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Converte DD/MM/AAAA para YYYY-MM-DD */
function parseBRDate(raw: string): string | undefined {
  const [d, m, y] = raw.split(/[-/]/)
  const day = Number(d)
  const month = Number(m)
  const year = Number(y)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (year < 1900 || year > 2200 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return undefined
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export function valorTotalExtraidoValido(
  extracted: NfPdfExtracted,
): extracted is NfPdfExtracted & { valor_bruto: number } {
  const valor = extracted.valor_bruto
  return valor !== undefined
    && Number.isFinite(valor)
    && valor > 0
    && valor <= 1_000_000_000_000
    && extracted.origem_valor_bruto !== undefined
    && (extracted.confianca?.valor_bruto ?? 0) >= MIN_CRITICAL_CONFIDENCE
    && !extracted.motivos_bloqueio?.some((reason) => reason.endsWith('_conflict'))
}

export type DanfePersistenceGate =
  | { ok: true }
  | { ok: false; failedFields: DanfeCriticalField[]; reasons: string[] }

export function validarDanfeParaPersistencia(extracted: NfPdfExtracted): DanfePersistenceGate {
  const failedFields: DanfeCriticalField[] = []
  if (!extracted.numero_nf || (extracted.confianca?.numero_nf ?? 0) < MIN_CRITICAL_CONFIDENCE) failedFields.push('numero_nf')
  if (!extracted.cnpj_emitente || (extracted.confianca?.cnpj_emitente ?? 0) < MIN_CRITICAL_CONFIDENCE) failedFields.push('cnpj_emitente')
  if (!extracted.data_emissao || (extracted.confianca?.data_emissao ?? 0) < MIN_CRITICAL_CONFIDENCE) failedFields.push('data_emissao')
  if (!valorTotalExtraidoValido(extracted)) failedFields.push('valor_bruto')
  const reasons = extracted.motivos_bloqueio || []
  return failedFields.length || reasons.some((reason) => reason === 'invalid_access_key' || reason.endsWith('_conflict'))
    ? { ok: false, failedFields, reasons }
    : { ok: true }
}
