export interface CteParticipante {
  cnpj: string | null
  razao_social: string | null
  nome_fantasia?: string | null
  inscricao_estadual?: string | null
  municipio_codigo?: string | null
  municipio_nome?: string | null
  uf?: string | null
}

export interface CteQuantidadeCarga {
  codigo_unidade: string | null
  tipo_medida: string | null
  quantidade: number | null
}

export interface CteXmlParseResult {
  valido: boolean
  erros: string[]
  xml_original: string
  versao_layout: string | null
  chave_cte: string | null
  chave_cte_infcte: string | null
  chave_cte_protocolo: string | null
  numero: string | null
  serie: string | null
  data_emissao: string | null
  data_autorizacao: string | null
  modelo: string | null
  ambiente: string | null
  tipo_cte: string | null
  tipo_servico: string | null
  modal: string | null
  cfop: string | null
  natureza_operacao: string | null
  protocolo_autorizacao: string | null
  status_autorizacao: string | null
  motivo_status: string | null
  digest: string | null
  cnpj_transportadora: string | null
  cnpj_remetente: string | null
  cnpj_destinatario: string | null
  transportadora: CteParticipante
  remetente: CteParticipante
  destinatario: CteParticipante
  municipio_origem_codigo: string | null
  municipio_origem_nome: string | null
  uf_origem: string | null
  municipio_destino_codigo: string | null
  municipio_destino_nome: string | null
  uf_destino: string | null
  rntrc: string | null
  /** Codigo <toma>: 0=remetente,1=expedidor,2=recebedor,3=destinatario,4=outro (terceiro, dados em toma4). */
  toma_codigo: string | null
  /** CNPJ do tomador (pagador do frete). Resolvido de toma4 (terceiro) ou, via codigo 0/3, de remetente/destinatario. Null quando o codigo aponta para um papel (expedidor/recebedor) que este parser nao extrai separadamente. */
  cnpj_tomador: string | null
  tomador: CteParticipante | null
  valor_frete: number | null
  valor_prestacao: number | null
  valor_receber: number | null
  componentes_frete: Array<{ nome: string | null; valor: number | null }>
  valor_carga: number | null
  produto_predominante: string | null
  categoria_carga: string | null
  quantidade_carga: number | null
  unidade_carga: string | null
  peso_bruto: number | null
  peso_liquido: number | null
  volume_quantidade: number | null
  quantidades_carga: CteQuantidadeCarga[]
  chaves_nfe_referenciadas: string[]
  documentos_referenciados: Array<{ tipo: string; chave: string }>
}

function readFileText(input: File | string): Promise<string> {
  if (typeof input === 'string') return Promise.resolve(input)
  return input.text()
}

function section(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`<[^:>/]*:?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</[^:>/]*:?${name}>`, 'i'))
  return match?.[1]?.trim() || null
}

function sections(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<[^:>/]*:?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</[^:>/]*:?${name}>`, 'gi'))]
    .map((match) => match[1]?.trim())
    .filter(Boolean)
}

function tag(xml: string | null, name: string): string | null {
  if (!xml) return null
  const match = xml.match(new RegExp(`<[^:>/]*:?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</[^:>/]*:?${name}>`, 'i'))
  return match?.[1]?.trim() || null
}

function attr(xml: string, tagName: string, attrName: string): string | null {
  const match = xml.match(new RegExp(`<[^:>/]*:?${tagName}\\b[^>]*\\b${attrName}=["']([^"']+)["']`, 'i'))
  return match?.[1] || null
}

function digits(value: string | null | undefined): string | null {
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

function parseParticipante(xml: string | null): CteParticipante {
  const ender = section(xml || '', 'enderEmit') || section(xml || '', 'enderReme') || section(xml || '', 'enderDest') || section(xml || '', 'enderToma') || ''
  return {
    cnpj: digits(tag(xml, 'CNPJ')),
    razao_social: tag(xml, 'xNome'),
    nome_fantasia: tag(xml, 'xFant'),
    inscricao_estadual: tag(xml, 'IE'),
    municipio_codigo: tag(ender, 'cMun'),
    municipio_nome: tag(ender, 'xMun'),
    uf: tag(ender, 'UF'),
  }
}

function parseTomador(infCte: string, remetente: CteParticipante, destinatario: CteParticipante): { toma_codigo: string | null; cnpj_tomador: string | null; tomador: CteParticipante | null } {
  const toma4 = section(infCte, 'toma4')
  if (toma4) {
    const terceiro = parseParticipante(toma4)
    return { toma_codigo: '4', cnpj_tomador: terceiro.cnpj, tomador: terceiro.cnpj ? terceiro : null }
  }
  const toma3 = section(infCte, 'toma3')
  const codigo = toma3 ? tag(toma3, 'toma') : null
  if (codigo === '0') return { toma_codigo: codigo, cnpj_tomador: remetente.cnpj, tomador: remetente.cnpj ? remetente : null }
  if (codigo === '3') return { toma_codigo: codigo, cnpj_tomador: destinatario.cnpj, tomador: destinatario.cnpj ? destinatario : null }
  // Codigos 1 (expedidor) e 2 (recebedor) referenciam papeis que este parser
  // nao extrai como bloco separado de rem/dest -- retorna sem CNPJ resolvido
  // em vez de adivinhar, para que a classificacao de tomador trate como
  // nao verificavel (fail-closed) e nao um ALLOW indevido.
  return { toma_codigo: codigo, cnpj_tomador: null, tomador: null }
}

function parseComponentesFrete(xml: string): Array<{ nome: string | null; valor: number | null }> {
  return sections(xml, 'Comp').map((comp) => ({
    nome: tag(comp, 'xNome'),
    valor: asNumber(tag(comp, 'vComp')),
  }))
}

function parseQuantidades(xml: string): CteQuantidadeCarga[] {
  return sections(xml, 'infQ').map((infQ) => ({
    codigo_unidade: tag(infQ, 'cUnid'),
    tipo_medida: tag(infQ, 'tpMed'),
    quantidade: asNumber(tag(infQ, 'qCarga')),
  }))
}

export async function parseCteXml(input: File | string): Promise<CteXmlParseResult> {
  const xml = await readFileText(input)
  const erros: string[] = []

  if (!xml.trim().startsWith('<')) erros.push('XML vazio ou malformado.')
  const temCte = /<[^:>/]*:?CTe[\s>]/i.test(xml)
  const temCteProc = /<[^:>/]*:?cteProc[\s>]/i.test(xml)
  if (!temCte && !temCteProc) erros.push('Estrutura nao parece ser CT-e.')

  const infCte = section(xml, 'infCte') || ''
  const ide = section(infCte || xml, 'ide') || ''
  const emit = section(infCte || xml, 'emit') || ''
  const rem = section(infCte || xml, 'rem') || ''
  const dest = section(infCte || xml, 'dest') || ''
  const vPrest = section(infCte || xml, 'vPrest') || ''
  const infCarga = section(infCte || xml, 'infCarga') || ''
  const infProt = section(xml, 'infProt') || ''

  const id = attr(xml, 'infCte', 'Id')
  const chaveInfCte = digits(id?.replace(/^CTe/i, ''))
  const chaveProt = digits(tag(infProt, 'chCTe'))
  const chave = chaveInfCte || chaveProt
  if (chave && !/^\d{44}$/.test(chave)) erros.push('Chave CT-e fora do formato esperado.')
  if (chaveInfCte && chaveProt && chaveInfCte !== chaveProt) erros.push('Chave do CT-e diverge entre infCte.Id e protocolo.')

  const transportadora = parseParticipante(emit)
  const remetente = parseParticipante(rem)
  const destinatario = parseParticipante(dest)
  for (const [label, value] of [['transportadora', transportadora.cnpj], ['remetente', remetente.cnpj], ['destinatario', destinatario.cnpj]] as const) {
    if (value && !/^\d{14}$/.test(value)) erros.push(`CNPJ da ${label} invalido.`)
  }

  const chavesNfe = sections(infCte || xml, 'infNFe')
    .flatMap((infNFe) => [tag(infNFe, 'chave'), tag(infNFe, 'chNFe')])
    .concat(sections(infCte || xml, 'infDoc').flatMap((infDoc) => [tag(infDoc, 'chave'), tag(infDoc, 'chNFe')]))
    .map((value) => digits(value))
    .filter((value): value is string => !!value && /^\d{44}$/.test(value))
  if (chavesNfe.length === 0) erros.push('Nenhuma NF-e referenciada foi encontrada no CT-e.')

  const tomador = parseTomador(infCte || xml, remetente, destinatario)
  const quantidades = parseQuantidades(infCarga)
  const pesoBruto = quantidades.find((q) => /PESO BRUTO/i.test(q.tipo_medida || ''))?.quantidade ?? null
  const pesoLiquido = quantidades.find((q) => /PESO LIQ/i.test(q.tipo_medida || ''))?.quantidade ?? null
  const volume = quantidades.find((q) => /VOLUME|UNIDADE|VOL/i.test(q.tipo_medida || ''))?.quantidade ?? null
  // Prefere qualquer medida de PESO (BRUTO, LIQUIDO, REAL, BASE DE CALCULO --
  // rotulos variam entre emissores de CT-e) como quantidade principal, pois e
  // a que corresponde a unidade/quantidade da NF-e (uCom=KG) para o matching
  // de produtos/saldo com a NF de venda/remessa. Sem nenhuma medida de peso,
  // cai para a primeira quantidade nao nula (comportamento legado).
  const pesoPrincipal = quantidades.find((q) => /PESO/i.test(q.tipo_medida || '') && q.quantidade !== null)
  const primeiraNaoNula = quantidades.find((q) => q.quantidade !== null)
  const quantidadePrincipal = pesoPrincipal?.quantidade ?? primeiraNaoNula?.quantidade ?? null
  const unidadePrincipal = pesoPrincipal?.codigo_unidade ?? primeiraNaoNula?.codigo_unidade ?? null

  return {
    valido: erros.length === 0,
    erros,
    xml_original: xml,
    versao_layout: attr(xml, 'infCte', 'versao') || attr(xml, 'cteProc', 'versao'),
    chave_cte: chave || null,
    chave_cte_infcte: chaveInfCte || null,
    chave_cte_protocolo: chaveProt || null,
    numero: tag(ide, 'nCT'),
    serie: tag(ide, 'serie'),
    data_emissao: asDate(tag(ide, 'dhEmi') || tag(ide, 'dEmi')),
    data_autorizacao: asDate(tag(infProt, 'dhRecbto')),
    modelo: tag(ide, 'mod'),
    ambiente: tag(ide, 'tpAmb') || tag(infProt, 'tpAmb'),
    tipo_cte: tag(ide, 'tpCTe'),
    tipo_servico: tag(ide, 'tpServ'),
    modal: tag(ide, 'modal'),
    cfop: tag(ide, 'CFOP'),
    natureza_operacao: tag(ide, 'natOp'),
    protocolo_autorizacao: tag(infProt, 'nProt'),
    status_autorizacao: tag(infProt, 'cStat'),
    motivo_status: tag(infProt, 'xMotivo'),
    digest: tag(xml, 'DigestValue'),
    cnpj_transportadora: transportadora.cnpj,
    cnpj_remetente: remetente.cnpj,
    cnpj_destinatario: destinatario.cnpj,
    transportadora,
    remetente,
    destinatario,
    municipio_origem_codigo: tag(ide, 'cMunIni'),
    municipio_origem_nome: tag(ide, 'xMunIni'),
    uf_origem: tag(ide, 'UFIni'),
    municipio_destino_codigo: tag(ide, 'cMunFim'),
    municipio_destino_nome: tag(ide, 'xMunFim'),
    uf_destino: tag(ide, 'UFFim'),
    rntrc: tag(section(infCte || xml, 'rodo') || '', 'RNTRC'),
    toma_codigo: tomador.toma_codigo,
    cnpj_tomador: tomador.cnpj_tomador,
    tomador: tomador.tomador,
    valor_frete: asNumber(tag(vPrest, 'vTPrest') || tag(vPrest, 'vFrete')),
    valor_prestacao: asNumber(tag(vPrest, 'vTPrest')),
    valor_receber: asNumber(tag(vPrest, 'vRec')),
    componentes_frete: parseComponentesFrete(vPrest),
    valor_carga: asNumber(tag(infCarga, 'vCarga')),
    produto_predominante: tag(infCarga, 'proPred'),
    categoria_carga: tag(infCarga, 'xOutCat'),
    quantidade_carga: quantidadePrincipal,
    unidade_carga: unidadePrincipal,
    peso_bruto: pesoBruto,
    peso_liquido: pesoLiquido,
    volume_quantidade: volume,
    quantidades_carga: quantidades,
    chaves_nfe_referenciadas: [...new Set(chavesNfe)],
    documentos_referenciados: [...new Set(chavesNfe)].map((chaveNfe) => ({ tipo: 'nfe', chave: chaveNfe })),
  }
}
