import Decimal from 'decimal.js'
import { absentDocument, type CanonicalDocument } from '../canonical/schema'
import { FieldReader } from './fields'
import { at, NationalXmlError, type XmlNode } from './xml-tree'

function person(reader: FieldReader, node: XmlNode | undefined, emitted = false): CanonicalDocument['prestador'] {
  const end = at(node, emitted ? 'enderNac' : 'end')
  const national = emitted ? end : at(end, 'endNac')
  const foreign = at(end, 'endExt')
  const idCount = ['CNPJ', 'CPF', 'NIF', 'cNaoNIF'].filter(key => at(node, key)).length
  if (idCount > 1) throw new NationalXmlError('XML_PERSON_ID_CHOICE')
  return {
    cnpj: reader.taxId(node, 'CNPJ'), cpf: reader.taxId(node, 'CPF'), nif: reader.text(emitted ? undefined : node, 'NIF'),
    motivo_sem_nif: reader.text(emitted ? undefined : node, 'cNaoNIF'), caepf: reader.text(emitted ? undefined : node, 'CAEPF'), inscricao_municipal: reader.text(node, 'IM'),
    razao_social: reader.text(node, 'xNome'), nome_fantasia: reader.text(node, 'xFant'), email: reader.text(node, 'email'), telefone: reader.text(node, 'fone'),
    endereco: {
      logradouro: reader.text(end, 'xLgr'), numero: reader.text(end, 'nro'), complemento: reader.text(end, 'xCpl'), bairro: reader.text(end, 'xBairro'),
      codigo_municipio: reader.pattern(national, 'cMun', /^\d{7}$/, 'MUNICIPIO_IBGE'), municipio: reader.text(undefined, ''),
      uf: reader.pattern(national, 'UF', /^[A-Z]{2}$/, 'UF'), cep: reader.pattern(national, 'CEP', /^\d{8}$/, 'CEP'),
      codigo_pais: reader.text(foreign, 'cPais'), cidade_exterior: reader.text(foreign, 'xCidade'),
      estado_exterior: reader.text(foreign, 'xEstProvReg'), codigo_postal_exterior: reader.text(foreign, 'cEndPost'),
    },
  }
}

/** Direct declared values only. vServ and vTotNF are not mapped to legacy valor_bruto/liquido. */
function amounts(reader: FieldReader, nfse: XmlNode | undefined, dps: XmlNode | undefined): CanonicalDocument['totais'] {
  const doc = absentDocument().totais
  const values = at(dps, 'valores')
  const mapping: Partial<Record<keyof typeof doc, string>> = {
    valor_servicos: 'vServPrest/vServ', valor_recebido: 'vServPrest/vReceb', deducoes: 'vDedRed/vDR',
    desconto_condicionado: 'vDescCondIncond/vDescCond', desconto_incondicionado: 'vDescCondIncond/vDescIncond',
    valor_pis: 'trib/tribFed/piscofins/vPis', valor_cofins: 'trib/tribFed/piscofins/vCofins', base_pis_cofins: 'trib/tribFed/piscofins/vBCPisCofins',
    retencao_previdenciaria: 'trib/tribFed/vRetCP', retencao_irrf: 'trib/tribFed/vRetIRRF', retencao_csll: 'trib/tribFed/vRetCSLL',
  }
  for (const [key, path] of Object.entries(mapping)) {
    // The mapping is restricted to decimal fields; boolean/rate fields are assigned explicitly below.
    Object.assign(doc, { [key]: reader.money(values, path) })
  }
  const calculated = at(nfse, 'valores')
  doc.base_calculo_iss = reader.money(calculated, 'vBC')
  doc.aliquota_iss = reader.rate(calculated, 'pAliqAplic', 1)
  doc.valor_iss = reader.money(calculated, 'vISSQN')
  doc.total_retencoes = reader.money(calculated, 'vTotalRet')
  doc.liquido_documental = reader.money(calculated, 'vLiq')
  doc.iss_retido = reader.flag(values, 'trib/tribMun/tpRetISSQN', { '1': false, '2': true, '3': true })
  const pis = at(values, 'trib/tribFed/piscofins')
  doc.aliquota_pis = reader.rate(pis, 'pAliqPis')
  doc.aliquota_cofins = reader.rate(pis, 'pAliqCofins')
  if (at(pis, 'tpRetPisCofins')) {
    doc.pis_retido = reader.flag(pis, 'tpRetPisCofins', { '0': false, '1': true, '2': false, '3': true, '4': true, '5': true, '6': false, '7': false, '8': false, '9': true })
    doc.cofins_retido = reader.flag(pis, 'tpRetPisCofins', { '0': false, '1': true, '2': false, '3': true, '4': true, '5': false, '6': true, '7': true, '8': false, '9': false })
    const code = at(pis, 'tpRetPisCofins')?.text.trim()
    if (code !== '1' && code !== '2') doc.csll_retido = reader.flag(pis, 'tpRetPisCofins', { '0': false, '3': true, '4': false, '5': false, '6': false, '7': true, '8': true, '9': true })
  }
  const rtc = at(nfse, 'IBSCBS/totCIBS')
  doc.valor_ibs = reader.money(rtc, 'gIBS/vIBSTot')
  doc.valor_cbs = reader.money(rtc, 'gCBS/vCBS')
  doc.total_nf_com_ibscbs = reader.money(rtc, 'vTotNF')
  return doc
}

export function mapDps(reader: FieldReader, doc: CanonicalDocument, dps: XmlNode | undefined): void {
  doc.identificacao.dps = {
    id: reader.field(dps, s => { if (!/^DPS\d{42}$/.test(s)) throw new Error('ID'); return s }, 'ID_DPS', 'Id'),
    numero: reader.pattern(dps, 'nDPS', /^[1-9]\d{0,14}$/, 'NUMERO_DPS'), serie: reader.pattern(dps, 'serie', /^\d{1,5}$/, 'SERIE_DPS'),
    emissao: reader.timestamp(dps, 'dhEmi'),
  }
  // dhEmi is issuance of the declaration, not proven issuance of the resulting NFSe.
  doc.identificacao.competencia = reader.date(dps, 'dCompet')
  doc.identificacao.municipio_emissor = reader.pattern(dps, 'cLocEmi', /^\d{7}$/, 'MUNICIPIO_IBGE')
  doc.identificacao.ambiente = reader.pattern(dps, 'tpAmb', /^[12]$/, 'AMBIENTE')
  doc.identificacao.nota_substituida = reader.pattern(dps, 'subst/chSubstda', /^\d{50}$/, 'CHAVE_NFSE_50')
  doc.prestador = person(reader, at(dps, 'prest'))
  doc.tomador = person(reader, at(dps, 'toma'))
  doc.intermediario = person(reader, at(dps, 'interm'))
  const service = at(dps, 'serv')
  if (service) doc.servicos = [{
    descricao: reader.text(service, 'cServ/xDescServ'), codigo_tributacao_nacional: reader.pattern(service, 'cServ/cTribNac', /^\d{6}$/, 'CTRIBNAC'),
    codigo_tributacao_municipal: reader.text(service, 'cServ/cTribMun'), codigo_nbs: reader.text(service, 'cServ/cNBS'),
    municipio_prestacao: reader.pattern(service, 'locPrest/cLocPrestacao', /^\d{7}$/, 'MUNICIPIO_IBGE'), pais_prestacao: reader.text(service, 'locPrest/cPaisPrestacao'),
    tributacao_iss: reader.pattern(dps, 'valores/trib/tribMun/tribISSQN', /^[1-4]$/, 'TRIBUTACAO_ISS'),
    tipo_retencao_iss: reader.pattern(dps, 'valores/trib/tribMun/tpRetISSQN', /^[1-3]$/, 'TIPO_RETENCAO_ISS'),
    tipo_retencao_pis_cofins: reader.pattern(dps, 'valores/trib/tribFed/piscofins/tpRetPisCofins', /^[0-9]$/, 'TIPO_RETENCAO_PIS_COFINS'),
    cst_pis_cofins: reader.text(dps, 'valores/trib/tribFed/piscofins/CST'), regime_simples: reader.text(dps, 'prest/regTrib/opSimpNac'),
    regime_especial: reader.text(dps, 'prest/regTrib/regEspTrib'),
  }]
}

export function mapNfse(reader: FieldReader, doc: CanonicalDocument, nfse: XmlNode | undefined): void {
  const dps = at(nfse, 'DPS/infDPS')
  mapDps(reader, doc, dps)
  const declaredProvider = doc.prestador
  doc.prestador = person(reader, at(nfse, 'emit'), true)
  if (declaredProvider.cnpj.valor !== doc.prestador.cnpj.valor || declaredProvider.cpf.valor !== doc.prestador.cpf.valor) {
    doc.alertas_documento.push('PRESTADOR_DPS_DIVERGE_DO_EMITENTE_NFSE')
  }
  doc.identificacao.chave_acesso = reader.field(nfse, s => {
    if (!/^NFS\d{50}$/.test(s)) throw new Error('KEY'); return s.slice(3)
  }, 'CHAVE_NFSE_50', 'Id')
  doc.identificacao.numero_nfse = reader.pattern(nfse, 'nNFSe', /^[1-9]\d{0,12}$/, 'NUMERO_NFSE')
  doc.identificacao.processamento = reader.timestamp(nfse, 'dhProc')
  const statuses = doc.identificacao_layout.versao_documental === '1.00' ? /^(100|101|102|103)$/ : /^(100|102|103|107)$/
  doc.identificacao.codigo_status_geracao = reader.pattern(nfse, 'cStat', statuses, 'STATUS_GERACAO')
  doc.totais = amounts(reader, nfse, dps)
  const fields = ['valor_servicos', 'desconto_condicionado', 'desconto_incondicionado', 'total_retencoes'] as const
  const [gross, conditional, unconditional, retained] = fields.map(key => doc.totais[key])
  if (gross.valor !== null && conditional.valor !== null && unconditional.valor !== null && retained.valor !== null) {
    const net = new Decimal(gross.valor).minus(conditional.valor).minus(unconditional.valor).minus(retained.valor)
    if (net.isNegative()) doc.alertas_documento.push('LIQUIDO_DERIVADO_NEGATIVO')
    else {
      doc.totais.liquido_derivado = {
        estado: 'DERIVADO', original: null, valor: net.toFixed(2), origem: 'CALCULO', metodo: 'CALCULO_EVIDENCIADO',
        evidencias: [gross, conditional, unconditional, retained].flatMap(field => field.evidencias), confianca: null,
        validacoes: [], alertas: [], derivacao: { formula_versao: 'nacional-vliq-descontos-retencoes/1', campos_fontes: fields.map(key => `totais.${key}`) },
      }
      if (doc.totais.liquido_documental.valor !== null && !net.eq(doc.totais.liquido_documental.valor)) doc.alertas_documento.push('LIQUIDO_DOCUMENTAL_DIVERGE_DA_FORMULA')
    }
  }
}

export function mapStandaloneDps(reader: FieldReader, doc: CanonicalDocument, dps: XmlNode | undefined): void {
  mapDps(reader, doc, dps)
  doc.totais = amounts(reader, undefined, dps)
}
