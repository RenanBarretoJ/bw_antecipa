import { sha256 } from '../review-facts'
import { absentDocument, canonicalSchema, type CanonicalDocument } from '../canonical/schema'
import { FieldReader } from './fields'
import { validateDocumentIdentity } from './identity'
import { mapNfse, mapStandaloneDps } from './mapping'
import { assertNationalPayload, at, NATIONAL_NS, NationalXmlError, parseXmlSafely, XML_LIMITS, type XmlNode } from './xml-tree'

export type NationalXmlResult =
  | { resultado: 'RECONHECIDO'; documento: CanonicalDocument; problemas: string[] }
  | { resultado: 'INCOMPATIVEL' | 'INVALIDO'; codigo: string }

function mapEvent(reader: FieldReader, doc: CanonicalDocument, root: XmlNode): void {
  const registered = root.name === 'evento'
  const info = registered ? at(root, 'infEvento') : undefined
  const request = registered ? at(info, 'pedRegEvento/infPedReg') : at(root, 'infPedReg')
  const events = request?.children.filter(child => /^e\d{6}$/.test(child.name)) ?? []
  if (events.length !== 1) throw new NationalXmlError('XML_EVENT_CHOICE')
  const event = events[0]
  doc.evento = {
    tipo: doc.evento.tipo,
    id: reader.field(info, s => { if (!/^EVT\d{59}$/.test(s)) throw new Error('ID'); return s }, 'ID_EVENTO', 'Id'),
    pedido_id: reader.field(request, s => { if (!/^PRE\d{56}$/.test(s)) throw new Error('ID'); return s }, 'ID_PEDIDO_EVENTO', 'Id'),
    registro: reader.timestamp(info, 'dhProc'),
  }
  // The event node is a group; its name has its own evidence, not a concatenation of its text.
  doc.evento.tipo = { estado: 'PRESENTE', original: event.name, valor: event.name, origem: 'XML', metodo: 'XML_ESTRUTURAL',
    evidencias: [{ documento_sha256: reader.sha256, caminho: event.path, namespace: event.namespace }],
    confianca: null, validacoes: [{ codigo: 'TIPO_EVENTO', resultado: 'PASSOU' }], alertas: [], derivacao: null }
  doc.identificacao.chave_acesso = reader.pattern(request, 'chNFSe', /^\d{50}$/, 'CHAVE_NFSE_50')
  const eventKey = doc.identificacao.chave_acesso.valor
  if (eventKey) {
    const requestId = doc.evento.pedido_id.valor
    const eventId = doc.evento.id.valor
    const sequence = at(info, 'nSeqEvento')?.text.trim()
    if (requestId && requestId !== `PRE${eventKey}${event.name.slice(1)}`) reader.issues.push('ID_PEDIDO_DIVERGE_DA_CHAVE_EVENTO')
    if (eventId && sequence && eventId !== `EVT${eventKey}${event.name.slice(1)}${sequence.padStart(3, '0')}`) reader.issues.push('ID_EVENTO_DIVERGE_DA_CHAVE_TIPO_SEQUENCIA')
  }
  if (registered && ['e101101', 'e105102', 'e105104'].includes(event.name)) {
    doc.identificacao.situacao_declarada = reader.field(at(event, 'xDesc'), () => 'CANCELADA' as const, 'EVENTO_CANCELAMENTO_DECLARADO')
    doc.identificacao.cancelamento_data = reader.timestamp(info, 'dhProc')
    doc.identificacao.cancelamento_motivo = reader.text(event, 'xMotivo')
    doc.identificacao.nota_substituta = reader.pattern(event, 'chSubstituta', /^\d{50}$/, 'CHAVE_NFSE_50')
    doc.alertas_documento.push('CANCELAMENTO_DECLARADO_ASSINATURA_E_ORIGEM_NAO_VERIFICADAS')
  }
  doc.alertas_documento.push(registered ? 'EVENTO_REGISTRADO_NAO_E_NOTA' : 'PEDIDO_DE_EVENTO_NAO_COMPROVA_EFEITO_FISCAL')
}

/** Read-only extraction. No routes, storage, database, approval, network or financial projection. */
export function extractNationalXml(input: string | Uint8Array): NationalXmlResult {
  try {
    let xml: string
    if (typeof input === 'string') xml = input
    else {
      if (input.byteLength > XML_LIMITS.bytes) throw new NationalXmlError('XML_SIZE')
      try { xml = new TextDecoder('utf-8', { fatal: true }).decode(input) }
      catch { throw new NationalXmlError('XML_UTF8_INVALID') }
    }
    const root = parseXmlSafely(xml)
    if (root.namespace !== NATIONAL_NS) return { resultado: 'INCOMPATIVEL', codigo: 'NAMESPACE_NAO_NACIONAL' }
    if (!['NFSe', 'DPS', 'evento', 'pedRegEvento'].includes(root.name)) return { resultado: 'INCOMPATIVEL', codigo: 'DOCUMENTO_NAO_SUPORTADO' }
    const version = root.attributes.versao
    if (version !== '1.00' && version !== '1.01') return { resultado: 'INCOMPATIVEL', codigo: 'VERSAO_NAO_SUPORTADA' }
    assertNationalPayload(root)
    const nestedVersion = at(root, 'infNFSe/DPS')?.attributes.versao
    if (nestedVersion !== undefined && nestedVersion !== version) throw new NationalXmlError('XML_DPS_VERSION_CONFLICT')
    const reader = new FieldReader(sha256(typeof input === 'string' ? input : Buffer.from(input)))
    const doc = absentDocument()
    doc.originais = [{ sha256: reader.sha256, formato: 'XML' }]
    doc.identificacao_layout = { familia: 'NACIONAL', provedor: null, versao_documental: version,
      namespace: NATIONAL_NS, perfil_id: `nacional-prod-20260209/${version}`, status_cobertura: 'ESTRUTURAL' }
    doc.natureza_documento = root.name === 'NFSe' ? 'NFSE' : root.name === 'DPS' ? 'DPS' : 'EVENTO'
    const info = at(root, root.name === 'NFSe' ? 'infNFSe' : root.name === 'DPS' ? 'infDPS' : root.name === 'evento' ? 'infEvento' : 'infPedReg')
    if (!info) throw new NationalXmlError('XML_MISSING_DOCUMENT_GROUP')
    doc.identificacao.situacao = {
      estado: 'DERIVADO', original: null, valor: 'DESCONHECIDA', origem: 'CALCULO', metodo: 'CALCULO_EVIDENCIADO',
      evidencias: [{ documento_sha256: reader.sha256, caminho: root.path, namespace: root.namespace }],
      confianca: null, validacoes: [{ codigo: 'SITUACAO_FISCAL_NAO_VERIFICADA', resultado: 'NAO_EXECUTADA' }],
      alertas: [], derivacao: { formula_versao: 'nao-inferir-situacao-fiscal/1', campos_fontes: ['verificacao.assinatura', 'verificacao.consulta_fiscal'] },
    }
    if (root.name === 'NFSe') {
      mapNfse(reader, doc, info)
      const required = ['nNFSe', 'cStat', 'dhProc', 'emit/xNome', 'valores/vLiq', 'DPS/infDPS/prest', 'DPS/infDPS/serv/cServ/xDescServ', 'DPS/infDPS/valores/vServPrest/vServ']
      for (const path of required) if (!at(info, path)) reader.issues.push(`CAMPO_OBRIGATORIO_AUSENTE:${path}`)
      if (!info.attributes.Id) reader.issues.push('ID_NFSE_AUSENTE')
    } else if (root.name === 'DPS') {
      mapStandaloneDps(reader, doc, info)
      for (const path of ['tpAmb', 'dhEmi', 'serie', 'nDPS', 'dCompet', 'cLocEmi', 'prest', 'serv', 'valores/vServPrest/vServ']) {
        if (!at(info, path)) reader.issues.push(`CAMPO_OBRIGATORIO_AUSENTE:${path}`)
      }
      doc.alertas_documento.push('DPS_NAO_E_NFSE_EMITIDA')
    } else mapEvent(reader, doc, root)
    if (doc.natureza_documento === 'NFSE' || doc.natureza_documento === 'DPS') validateDocumentIdentity(reader, doc, info)
    function collectUnmapped(node: XmlNode): void {
      if (node.namespace !== NATIONAL_NS) return
      if (!node.children.length && !reader.consumedPaths.has(node.path)) doc.campos_nao_mapeados.push({
        documento_sha256: reader.sha256, caminho: node.path, namespace: node.namespace,
      })
      node.children.forEach(collectUnmapped)
    }
    collectUnmapped(root)
    doc.alertas_documento.push('EXTRACAO_NAO_COMPROVA_AUTORIZACAO_ATIVIDADE_OU_ELEGIBILIDADE')
    return { resultado: 'RECONHECIDO', documento: canonicalSchema.parse(doc), problemas: reader.issues }
  } catch (error) {
    if (error instanceof NationalXmlError) return { resultado: 'INVALIDO', codigo: error.code }
    // No fiscal content, stack trace, parser diagnostics or internal paths in public errors.
    return { resultado: 'INVALIDO', codigo: 'XML_EXTRACTION_FAILED' }
  }
}
