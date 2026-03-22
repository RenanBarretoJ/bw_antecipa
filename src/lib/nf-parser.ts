// ============================================================
// Parser de NF-e XML (padrao SEFAZ) e extrator basico de PDF
// ============================================================

export interface NfParsedData {
  numero_nf: string
  serie: string
  chave_acesso: string
  data_emissao: string
  data_vencimento: string
  cnpj_emitente: string
  razao_social_emitente: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  valor_liquido: number
  valor_icms: number
  valor_iss: number
  valor_pis: number
  valor_cofins: number
  valor_ipi: number
  descricao_itens: string
  condicao_pagamento: string
}

function getTagValue(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i')
  const match = xml.match(regex)
  return match?.[1]?.trim() || ''
}

function getNestedTagValue(xml: string, parent: string, child: string): string {
  const parentRegex = new RegExp(`<${parent}[^>]*>([\\s\\S]*?)</${parent}>`, 'i')
  const parentMatch = xml.match(parentRegex)
  if (!parentMatch) return ''
  return getTagValue(parentMatch[1], child)
}

function getAllBlocks(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  const matches: string[] = []
  let m
  while ((m = regex.exec(xml)) !== null) {
    matches.push(m[1])
  }
  return matches
}

function parseNumber(val: string): number {
  if (!val) return 0
  return parseFloat(val.replace(',', '.')) || 0
}

function formatDateISO(val: string): string {
  if (!val) return ''
  // Formato SEFAZ: 2024-01-15T10:30:00-03:00 ou 2024-01-15
  return val.substring(0, 10)
}

export function parseNFeXML(xmlContent: string): NfParsedData {
  // Chave de acesso do atributo Id da infNFe
  const infNFeMatch = xmlContent.match(/Id="NFe(\d{44})"/)
  const chave_acesso = infNFeMatch?.[1] || ''

  // Dados da identificacao
  const numero_nf = getNestedTagValue(xmlContent, 'ide', 'nNF')
  const serie = getNestedTagValue(xmlContent, 'ide', 'serie')
  const data_emissao = formatDateISO(getNestedTagValue(xmlContent, 'ide', 'dhEmi') || getNestedTagValue(xmlContent, 'ide', 'dEmi'))

  // Emitente
  const emitBlock = xmlContent.match(/<emit>([\s\S]*?)<\/emit>/i)?.[1] || ''
  const cnpj_emitente = getTagValue(emitBlock, 'CNPJ')
  const razao_social_emitente = getTagValue(emitBlock, 'xNome')

  // Destinatario
  const destBlock = xmlContent.match(/<dest>([\s\S]*?)<\/dest>/i)?.[1] || ''
  const cnpj_destinatario = getTagValue(destBlock, 'CNPJ')
  const razao_social_destinatario = getTagValue(destBlock, 'xNome')

  // Totais
  const icmsTotBlock = xmlContent.match(/<ICMSTot>([\s\S]*?)<\/ICMSTot>/i)?.[1] || ''
  const valor_bruto = parseNumber(getTagValue(icmsTotBlock, 'vNF'))
  const valor_icms = parseNumber(getTagValue(icmsTotBlock, 'vICMS'))
  const valor_ipi = parseNumber(getTagValue(icmsTotBlock, 'vIPI'))
  const valor_pis = parseNumber(getTagValue(icmsTotBlock, 'vPIS'))
  const valor_cofins = parseNumber(getTagValue(icmsTotBlock, 'vCOFINS'))

  // ISS (para notas de servico)
  const issBlock = xmlContent.match(/<ISSQNtot>([\s\S]*?)<\/ISSQNtot>/i)?.[1] || ''
  const valor_iss = parseNumber(getTagValue(issBlock, 'vISS'))

  // Valor liquido
  const valor_liquido = valor_bruto - valor_icms - valor_iss - valor_pis - valor_cofins - valor_ipi

  // Itens / produtos
  const detBlocks = getAllBlocks(xmlContent, 'det')
  const itens = detBlocks.map((det) => {
    const prodBlock = det.match(/<prod>([\s\S]*?)<\/prod>/i)?.[1] || ''
    const nome = getTagValue(prodBlock, 'xProd')
    const qtd = getTagValue(prodBlock, 'qCom')
    const valor = getTagValue(prodBlock, 'vProd')
    return `${nome} (Qtd: ${qtd}, R$ ${valor})`
  })
  const descricao_itens = itens.join('; ')

  // Vencimento — duplicatas
  const dupBlocks = getAllBlocks(xmlContent, 'dup')
  let data_vencimento = ''
  if (dupBlocks.length > 0) {
    const lastDup = dupBlocks[dupBlocks.length - 1]
    data_vencimento = formatDateISO(getTagValue(lastDup, 'dVenc'))
  }

  // Condicao de pagamento
  const pagBlock = xmlContent.match(/<pag>([\s\S]*?)<\/pag>/i)?.[1] || ''
  const tPag = getTagValue(pagBlock, 'tPag')
  const pagMap: Record<string, string> = {
    '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartao de Credito',
    '04': 'Cartao de Debito', '05': 'Credito Loja', '15': 'Boleto',
    '90': 'Sem pagamento', '99': 'Outros',
  }
  const condicao_pagamento = pagMap[tPag] || tPag || ''

  return {
    numero_nf,
    serie,
    chave_acesso,
    data_emissao,
    data_vencimento,
    cnpj_emitente,
    razao_social_emitente,
    cnpj_destinatario,
    razao_social_destinatario,
    valor_bruto,
    valor_liquido: Math.max(0, valor_liquido),
    valor_icms,
    valor_iss,
    valor_pis,
    valor_cofins,
    valor_ipi,
    descricao_itens,
    condicao_pagamento,
  }
}
