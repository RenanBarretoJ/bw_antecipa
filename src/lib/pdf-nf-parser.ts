// Import dinâmico: pdf-parse v1 tenta abrir arquivo de teste na avaliação do módulo,
// o que quebra no Next.js. O import lazy evita esse comportamento.
// Importar diretamente a implementação interna, ignorando o index.js.
// O index.js do pdf-parse v1 executa `!module.parent` e tenta ler um arquivo de teste
// que não existe no projeto — o que causa ENOENT em ambientes Next.js.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const getPdfParse = () => require('pdf-parse/lib/pdf-parse.js') as (buffer: Buffer) => Promise<{ text: string }>

export interface NfPdfExtracted {
  numero_nf?: string
  serie?: string
  chave_acesso?: string
  data_emissao?: string       // YYYY-MM-DD
  data_vencimento?: string    // YYYY-MM-DD
  // cnpj_emitente e razao_social_emitente são intencionalmente omitidos:
  // sempre usam os dados do cedente autenticado — não confiamos no PDF
  cnpj_destinatario?: string  // só dígitos
  razao_social_destinatario?: string
  valor_bruto?: number   // V. TOTAL PRODUTOS
  valor_liquido?: number // V. TOTAL DA NOTA
  condicao_pagamento?: string
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

  try {
    const pdfParse = getPdfParse()
    const result = await pdfParse(buffer)
    text = result.text || ''
  } catch {
    return { campos_extraidos: [] }
  }

  // PDF escaneado (imagem) — texto insuficiente para extração
  if (text.replace(/\s/g, '').length < 50) {
    return { campos_extraidos: [] }
  }

  // Normalizar: múltiplos espaços → um espaço, manter case original para regex case-insensitive
  const normalized = text.replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n').trim()

  const campos_extraidos: string[] = []
  const extracted: NfPdfExtracted = { campos_extraidos }

  const numero = extractNumeroNF(normalized)
  if (numero) { extracted.numero_nf = numero; campos_extraidos.push('numero_nf') }

  const serie = extractSerie(normalized)
  if (serie) { extracted.serie = serie; campos_extraidos.push('serie') }

  const chave = extractChaveAcesso(normalized)
  if (chave) { extracted.chave_acesso = chave; campos_extraidos.push('chave_acesso') }

  const dataEmissao = extractDataEmissao(normalized)
  if (dataEmissao) { extracted.data_emissao = dataEmissao; campos_extraidos.push('data_emissao') }

  const dataVencimento = extractDataVencimento(normalized)
  if (dataVencimento) { extracted.data_vencimento = dataVencimento; campos_extraidos.push('data_vencimento') }

  const { destinatario: cnpjDest } = extractCnpjs(normalized)
  if (cnpjDest) { extracted.cnpj_destinatario = cnpjDest; campos_extraidos.push('cnpj_destinatario') }

  const razaoDest = extractRazaoSocialDestinatario(normalized)
  if (razaoDest) { extracted.razao_social_destinatario = razaoDest; campos_extraidos.push('razao_social_destinatario') }

  const valor = extractValorProdutos(normalized)
  if (valor) { extracted.valor_bruto = valor; campos_extraidos.push('valor_bruto') }

  const valorNota = extractValorNota(normalized)
  if (valorNota) { extracted.valor_liquido = valorNota; campos_extraidos.push('valor_liquido') }

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
    /NF-?e[\s\n]+N[°º]\.?\s*(\d[\d.]{0,11})/i,
    // "Nº. 000.006.942" no início de linha
    /^N[°º]\.?\s+(\d[\d.]{0,11})/im,
    // "ELETRÔNICA Nº 9.700" — banner de rodapé (MD SAUDE, BIOREGENERA)
    /ELETR[ÔO]NICA\s+N[°º]\.?\s*(\d[\d.,]{0,11})/i,
    /N[°º]\s+DA\s+NOTA\s*[:\-]?\s*(\d[\d.]{0,11})/i,
    /NOTA\s+FISCAL\s+N[°º\.]+\s*(\d[\d.]{0,11})/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return m[1].replace(/[.,]/g, '')
  }
  return undefined
}

function extractSerie(text: string): string | undefined {
  const m = text.match(/S[ÉE]R(?:IE|\.)\s*[:\-]?\s*(\d{1,3})/i)
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
    /DATA\s+(?:DE\s+)?EMISS[ÃA]O\s*[:\-\/]?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /EMISS[ÃA]O\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
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

// V. TOTAL PRODUTOS → valor_bruto
function extractValorProdutos(text: string): number | undefined {
  const patterns = [
    /V\.?\s*TOTAL\s+(?:DOS\s+)?PRODUTOS\s*R?\$?\s*([\d.,]+)/i,
    /VALOR\s+TOTAL\s+(?:DOS\s+)?PRODUTOS\s*R?\$?\s*([\d.,]+)/i,
    /TOTAL\s+(?:DOS\s+)?PRODUTOS\s*R?\$?\s*([\d.,]+)/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) {
      const v = parseBRLValue(m[1])
      if (v > 0) return v
    }
  }
  return undefined
}

// V. TOTAL DA NOTA → valor_liquido
function extractValorNota(text: string): number | undefined {
  const patterns = [
    /V\.?\s*TOTAL\s+DA\s+NOTA\s*R?\$?\s*([\d.,]+)/i,
    /VALOR\s+TOTAL\s+DA\s+NOTA\s*R?\$?\s*([\d.,]+)/i,
    /TOTAL\s+DA\s+(?:NF|NOTA)\s*R?\$?\s*([\d.,]+)/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) {
      const v = parseBRLValue(m[1])
      if (v > 0) return v
    }
  }
  return undefined
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
function parseBRDate(raw: string): string {
  const [d, m, y] = raw.split('/')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** Converte valor monetário BR (1.234,56) para number */
function parseBRLValue(raw: string): number {
  // Remove pontos de milhar, troca vírgula decimal por ponto
  return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0
}
