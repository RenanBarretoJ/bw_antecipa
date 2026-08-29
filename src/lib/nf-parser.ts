// ============================================================
// Parser de NF-e XML (padrao SEFAZ) e extrator basico de PDF
// ============================================================

export interface NfParsedParcela {
  numero_parcela: number
  data_vencimento: string
  valor_nominal: number
}

export interface NfParsedItem {
  descricao: string
  /** cProd -- codigo do produto no catalogo do emitente. Usado para matching deterministico (regra 4 do ticket de ajustes finais). */
  codigo: string
  /** NCM -- classificacao fiscal do produto. Segundo criterio deterministico quando cProd nao casa (emitentes diferentes usam catalogos proprios). */
  ncm: string
  quantidade: number
  unidade: string
  valor: number
}

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
  destinatario_endereco: {
    cep: string
    logradouro: string
    numero: string
    complemento: string
    bairro: string
    municipio: string
    uf: string
    email: string
    telefone: string
  }
  valor_bruto: number
  valor_liquido: number
  valor_icms: number
  valor_iss: number
  valor_pis: number
  valor_cofins: number
  valor_ipi: number
  descricao_itens: string
  condicao_pagamento: string
  /** Parcelas extraidas de <cobr><dup> do XML. Vazio quando a NF nao tem <dup> (comportamento legado preservado). */
  parcelas: NfParsedParcela[]
  /** Itens estruturados de <det><prod> (codigo/descricao/quantidade/unidade/valor), para matching de remessa e auditoria. */
  itensEstruturados: NfParsedItem[]
  /** Soma de qCom de todos os <det><prod>. Usado como saldo logistico entre NF de venda e suas remessas. */
  quantidadeTotal: number
  /** Chaves referenciadas em <NFref><refNFe>, na ordem em que aparecem no XML. Usado por NF de remessa para provar o vinculo com a venda. */
  nfRefChaves: string[]
  /** Texto de <infAdic><infCpl>, evidencia complementar (nao substitui NFref estruturado). */
  evidenciaComplementar: string
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
  const enderecoDestinatario = destBlock.match(/<enderDest>([\s\S]*?)<\/enderDest>/i)?.[1] || ''
  const destinatario_endereco = {
    cep: getTagValue(enderecoDestinatario, 'CEP'),
    logradouro: getTagValue(enderecoDestinatario, 'xLgr'),
    numero: getTagValue(enderecoDestinatario, 'nro'),
    complemento: getTagValue(enderecoDestinatario, 'xCpl'),
    bairro: getTagValue(enderecoDestinatario, 'xBairro'),
    municipio: getTagValue(enderecoDestinatario, 'xMun'),
    uf: getTagValue(enderecoDestinatario, 'UF'),
    email: getTagValue(destBlock, 'email'),
    telefone: getTagValue(enderecoDestinatario, 'fone'),
  }

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

  // Valor liquido = valor bruto (impostos sao salvos no BD mas nao deduzidos nesta etapa)
  const valor_liquido = valor_bruto

  // Itens / produtos
  const detBlocks = getAllBlocks(xmlContent, 'det')
  const itensEstruturados: NfParsedItem[] = detBlocks.map((det) => {
    const prodBlock = det.match(/<prod>([\s\S]*?)<\/prod>/i)?.[1] || ''
    return {
      descricao: getTagValue(prodBlock, 'xProd'),
      codigo: getTagValue(prodBlock, 'cProd'),
      ncm: getTagValue(prodBlock, 'NCM'),
      quantidade: parseNumber(getTagValue(prodBlock, 'qCom')),
      unidade: getTagValue(prodBlock, 'uCom'),
      valor: parseNumber(getTagValue(prodBlock, 'vProd')),
    }
  })
  const descricao_itens = itensEstruturados
    .map((item) => `${item.descricao} (Qtd: ${item.quantidade}, R$ ${item.valor})`)
    .join('; ')
  const quantidadeTotal = itensEstruturados.reduce((total, item) => total + item.quantidade, 0)

  // NFref/refNFe: chave(s) da(s) NF-e referenciada(s) por esta NF (usado pela
  // NF de remessa para provar o vinculo com a NF de venda). infAdic/infCpl e
  // apenas evidencia complementar, nunca substitui a referencia estruturada.
  const nfRefBlocks = getAllBlocks(xmlContent, 'NFref')
  const nfRefChaves = nfRefBlocks
    .map((bloco) => getTagValue(bloco, 'refNFe'))
    .filter((chave) => /^\d{44}$/.test(chave))
  const infAdicBlock = xmlContent.match(/<infAdic>([\s\S]*?)<\/infAdic>/i)?.[1] || ''
  const evidenciaComplementar = getTagValue(infAdicBlock, 'infCpl')

  // Vencimento — duplicatas. O agregado da NF preserva o comportamento
  // legado (data da ultima <dup>); parcelas captura cada <dup> individual
  // (nDup/dVenc/vDup) para a Fase 1 de Parcelas de NF.
  const dupBlocks = getAllBlocks(xmlContent, 'dup')
  let data_vencimento = ''
  if (dupBlocks.length > 0) {
    const lastDup = dupBlocks[dupBlocks.length - 1]
    data_vencimento = formatDateISO(getTagValue(lastDup, 'dVenc'))
  }
  const parcelas: NfParsedParcela[] = dupBlocks.map((dup, index) => {
    const nDup = parseInt(getTagValue(dup, 'nDup'), 10)
    return {
      numero_parcela: Number.isInteger(nDup) && nDup > 0 ? nDup : index + 1,
      data_vencimento: formatDateISO(getTagValue(dup, 'dVenc')),
      valor_nominal: parseNumber(getTagValue(dup, 'vDup')),
    }
  })

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
    destinatario_endereco,
    valor_bruto,
    valor_liquido,
    valor_icms,
    valor_iss,
    valor_pis,
    valor_cofins,
    valor_ipi,
    descricao_itens,
    condicao_pagamento,
    parcelas,
    itensEstruturados,
    quantidadeTotal,
    nfRefChaves,
    evidenciaComplementar,
  }
}
