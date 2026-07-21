export interface CteXmlParseResult {
  valido: boolean
  erros: string[]
  chave_cte: string | null
  numero: string | null
  serie: string | null
  data_emissao: string | null
  cnpj_transportadora: string | null
  cnpj_remetente: string | null
  cnpj_destinatario: string | null
  valor_frete: number | null
  chaves_nfe_referenciadas: string[]
}

function tag(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`<[^:>/]*:?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</[^:>/]*:?${name}>`, 'i'))
  return match?.[1]?.trim() || null
}

function allTags(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<[^:>/]*:?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</[^:>/]*:?${name}>`, 'gi'))]
    .map((match) => match[1]?.trim())
    .filter(Boolean)
}

function attr(xml: string, tagName: string, attrName: string): string | null {
  const match = xml.match(new RegExp(`<[^:>/]*:?${tagName}\\b[^>]*\\b${attrName}=["']([^"']+)["']`, 'i'))
  return match?.[1] || null
}

function digits(value: string | null): string | null {
  if (!value) return null
  const only = value.replace(/\D/g, '')
  return only || null
}

function asNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function asDate(value: string | null): string | null {
  if (!value) return null
  const date = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

export async function parseCteXml(file: File): Promise<CteXmlParseResult> {
  const xml = await file.text()
  const erros: string[] = []

  if (!xml.trim().startsWith('<')) erros.push('XML vazio ou malformado.')
  if (!/<[^:>/]*:?CTe[\s>]/i.test(xml) && !/<[^:>/]*:?cteProc[\s>]/i.test(xml)) {
    erros.push('Estrutura nao parece ser CT-e.')
  }

  const id = attr(xml, 'infCte', 'Id')
  const chave = digits(id?.replace(/^CTe/i, '') || tag(xml, 'chCTe'))
  if (chave && !/^\d{44}$/.test(chave)) erros.push('Chave CT-e fora do formato esperado.')

  const cnpjTransportadora = digits(tag(xml, 'emit') ? tag(tag(xml, 'emit') || '', 'CNPJ') : tag(xml, 'CNPJ'))
  const remetenteXml = tag(xml, 'rem') || ''
  const destinatarioXml = tag(xml, 'dest') || ''
  const cnpjRemetente = digits(tag(remetenteXml, 'CNPJ'))
  const cnpjDestinatario = digits(tag(destinatarioXml, 'CNPJ'))
  for (const [label, value] of [['transportadora', cnpjTransportadora], ['remetente', cnpjRemetente], ['destinatario', cnpjDestinatario]] as const) {
    if (value && !/^\d{14}$/.test(value)) erros.push(`CNPJ da ${label} invalido.`)
  }

  const chavesNfe = allTags(xml, 'chave').concat(allTags(xml, 'chNFe')).map((value) => digits(value)).filter((value): value is string => !!value && /^\d{44}$/.test(value))
  if (chavesNfe.length === 0) erros.push('Nenhuma NF-e referenciada foi encontrada no CT-e.')

  return {
    valido: erros.length === 0,
    erros,
    chave_cte: chave || null,
    numero: tag(xml, 'nCT') || null,
    serie: tag(xml, 'serie') || null,
    data_emissao: asDate(tag(xml, 'dhEmi') || tag(xml, 'dEmi')),
    cnpj_transportadora: cnpjTransportadora,
    cnpj_remetente: cnpjRemetente,
    cnpj_destinatario: cnpjDestinatario,
    valor_frete: asNumber(tag(xml, 'vTPrest') || tag(xml, 'vFrete')),
    chaves_nfe_referenciadas: [...new Set(chavesNfe)],
  }
}
