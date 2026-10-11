import sax from 'sax'

/** POC infrastructure only. Fiscal mapping stays in the original adapter.
 * @param {string} xml
 * @param {{limits: typeof import('../../../../src/lib/nfse/xml-nacional/xml-tree').XML_LIMITS; ErrorClass: new (code: string) => Error}} policy
 * @returns {import('../../../../src/lib/nfse/xml-nacional/xml-tree').XmlNode}
 */
export function parseWithSax(xml, { limits, ErrorClass }) {
  /** @param {string} code @returns {never} */
  const fail = code => { throw new ErrorClass(code) }
  if (!xml.trim() || Buffer.byteLength(xml, 'utf8') > limits.bytes) fail('XML_SIZE')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('XML_DTD_FORBIDDEN')
  // sax defaults also recognize HTML entities. Request XML-only entities explicitly.
  // @types/sax currently omits this documented runtime option.
  /** @type {import('sax').SAXOptions & { strictEntities: boolean }} */
  const options = {
    xmlns: true, trim: false, normalize: false, position: true, strictEntities: true,
  }
  const parser = sax.parser(true, options)
  /** @type {import('../../../../src/lib/nfse/xml-nacional/xml-tree').XmlNode[]} */
  const stack = []
  /** @type {import('../../../../src/lib/nfse/xml-nacional/xml-tree').XmlNode | undefined} */
  let root
  let count = 0
  /** @type {WeakMap<import('../../../../src/lib/nfse/xml-nacional/xml-tree').XmlNode, Map<string, number>>} */
  const occurrences = new WeakMap()
  parser.onerror = () => fail('XML_MALFORMED')
  parser.ondoctype = () => fail('XML_DTD_FORBIDDEN')
  parser.onprocessinginstruction = declaration => {
    if (declaration.name.toLowerCase() !== 'xml') return
    const version = /\bversion\s*=\s*(['"])(.*?)\1/.exec(declaration.body)?.[2]
    const encoding = /\bencoding\s*=\s*(['"])(.*?)\1/.exec(declaration.body)?.[2]
    if (version !== '1.0' || (encoding && !/^utf-8$/i.test(encoding))) fail('XML_ENCODING_VERSION_UNSUPPORTED')
  }
  parser.onopentag = tag => {
    if (!('uri' in tag)) return fail('XML_NAMESPACE_CONFLICT')
    if (++count > limits.nodes || stack.length >= limits.depth || Object.keys(tag.attributes).length > limits.attributes) fail('XML_LIMIT')
    const parent = stack[stack.length - 1]
    /** @type {Map<string, number>} */
    const counters = parent ? occurrences.get(parent) ?? new Map() : new Map()
    const key = `${tag.uri}|${tag.local}`
    const ordinal = (counters.get(key) ?? 0) + 1
    counters.set(key, ordinal)
    /** @type {import('../../../../src/lib/nfse/xml-nacional/xml-tree').XmlNode} */
    const node = { name: tag.local, namespace: tag.uri,
      path: `${parent?.path ?? ''}/n:${tag.local}[${ordinal}]`, text: '', children: [],
      attributes: Object.fromEntries(Object.values(tag.attributes).filter(a => !a.uri).map(a => [a.local, a.value])) }
    occurrences.set(node, new Map())
    if (parent) parent.children.push(node)
    else if (root) fail('XML_MULTIPLE_ROOTS')
    else root = node
    stack.push(node)
  }
  /** @param {string} text */
  const append = text => { const node = stack[stack.length - 1]; if (node) node.text += text }
  parser.ontext = append
  parser.oncdata = append
  parser.onclosetag = () => { stack.pop() }
  parser.write(xml).close()
  if (!root) return fail('XML_MALFORMED')
  return root
}
