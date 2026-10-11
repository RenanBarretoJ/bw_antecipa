import { SaxesParser } from 'saxes'

export const NATIONAL_NS = 'http://www.sped.fazenda.gov.br/nfse'
export const XML_LIMITS = { bytes: 20 * 1024 * 1024, depth: 64, nodes: 50000, attributes: 64 } as const
export class NationalXmlError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'NationalXmlError' }
}
export interface XmlNode {
  name: string; namespace: string; path: string; text: string
  attributes: Record<string, string>; children: XmlNode[]
}

/** No entity resolution, I/O or recovery. Limits stop construction of the tree early. */
export function parseXmlSafely(xml: string): XmlNode {
  if (!xml.trim() || Buffer.byteLength(xml, 'utf8') > XML_LIMITS.bytes) throw new NationalXmlError('XML_SIZE')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new NationalXmlError('XML_DTD_FORBIDDEN')
  const parser = new SaxesParser({ xmlns: true, defaultXMLVersion: '1.0', forceXMLVersion: true })
  const stack: XmlNode[] = []
  let root: XmlNode | undefined
  let count = 0
  const occurrences = new WeakMap<XmlNode, Map<string, number>>()
  parser.on('error', () => { throw new NationalXmlError('XML_MALFORMED') })
  parser.on('doctype', () => { throw new NationalXmlError('XML_DTD_FORBIDDEN') })
  parser.on('xmldecl', declaration => {
    if (declaration.version !== '1.0' || (declaration.encoding && !/^utf-8$/i.test(declaration.encoding))) {
      throw new NationalXmlError('XML_ENCODING_VERSION_UNSUPPORTED')
    }
  })
  parser.on('opentag', tag => {
    if (++count > XML_LIMITS.nodes || stack.length >= XML_LIMITS.depth || Object.keys(tag.attributes).length > XML_LIMITS.attributes) {
      throw new NationalXmlError('XML_LIMIT')
    }
    const parent = stack[stack.length - 1]
    const counters = parent ? occurrences.get(parent) ?? new Map<string, number>() : new Map<string, number>()
    const tagKey = `${tag.uri}|${tag.local}`
    const ordinal = (counters.get(tagKey) ?? 0) + 1
    counters.set(tagKey, ordinal)
    const node: XmlNode = {
      name: tag.local, namespace: tag.uri, path: `${parent?.path ?? ''}/n:${tag.local}[${ordinal}]`, text: '',
      attributes: Object.fromEntries(Object.values(tag.attributes).filter(a => !a.uri).map(a => [a.local, a.value])), children: [],
    }
    occurrences.set(node, new Map())
    if (parent) parent.children.push(node)
    else if (root) throw new NationalXmlError('XML_MULTIPLE_ROOTS')
    else root = node
    stack.push(node)
  })
  const append = (text: string) => { const node = stack[stack.length - 1]; if (node) node.text += text }
  parser.on('text', append)
  parser.on('cdata', append)
  parser.on('closetag', () => { stack.pop() })
  parser.write(xml).close()
  if (!root) throw new NationalXmlError('XML_MALFORMED')
  return root
}

/** Exact namespace and direct-child resolution: no descendant search or local-name fallback. */
export function at(root: XmlNode | undefined, path: string): XmlNode | undefined {
  let node = root
  for (const part of path.split('/').filter(Boolean)) {
    const children = node?.children.filter(child => child.name === part && child.namespace === NATIONAL_NS) ?? []
    if (children.length > 1) throw new NationalXmlError('XML_AMBIGUOUS_FIELD')
    node = children[0]
  }
  return node
}

export function assertNationalPayload(root: XmlNode): void {
  const visit = (node: XmlNode) => {
    if (node.namespace === 'http://www.w3.org/2000/09/xmldsig#') return
    if (node.namespace !== NATIONAL_NS) throw new NationalXmlError('XML_NAMESPACE_CONFLICT')
    node.children.forEach(visit)
  }
  visit(root)
}
