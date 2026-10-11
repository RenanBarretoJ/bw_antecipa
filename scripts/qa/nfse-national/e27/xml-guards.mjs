/** @typedef {import('../../../../src/lib/nfse/xml-nacional/xml-tree').XmlNode} XmlNode */
/** @typedef {{ limits: typeof import('../../../../src/lib/nfse/xml-nacional/xml-tree').XML_LIMITS, ErrorClass: new (code: string) => Error }} Policy */

/** XML 1.0 Fifth Edition, production [2]. No repair or source normalization.
 * @param {number} point
 */
export function isXml10Character(point) {
  return point === 9 || point === 10 || point === 13
    || point >= 0x20 && point <= 0xd7ff || point >= 0xe000 && point <= 0xfffd
    || point >= 0x10000 && point <= 0x10ffff
}

/** @param {string} xml @param {Policy} policy */
export function validateInput(xml, { limits, ErrorClass }) {
  if (!xml.trim() || Buffer.byteLength(xml, 'utf8') > limits.bytes) throw new ErrorClass('XML_SIZE')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ErrorClass('XML_DTD_FORBIDDEN')
  for (let index = 0; index < xml.length; index++) {
    const point = xml.codePointAt(index)
    if (point === undefined || !isXml10Character(point)) throw new ErrorClass('XML_MALFORMED')
    if (point > 0xffff) index++
  }
}

// [23] XMLDecl: required version, then optional encoding, then optional standalone.
// Only XML whitespace is accepted; quote pairs and attribute order are enforced.
const declarationBody = /^version[\x20\t\r\n]*=[\x20\t\r\n]*(['"])(1\.[0-9]+)\1(?:[\x20\t\r\n]+encoding[\x20\t\r\n]*=[\x20\t\r\n]*(['"])([A-Za-z][A-Za-z0-9._-]*)\3)?(?:[\x20\t\r\n]+standalone[\x20\t\r\n]*=[\x20\t\r\n]*(['"])(yes|no)\5)?[\x20\t\r\n]*$/
// XML Name productions [4]/[4a], also used by PITarget. NBSP is not a name character.
const nameStart = ':A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}'
const xmlName = new RegExp(`^[${nameStart}][${nameStart}.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040-]*$`, 'u')

/** SAX PI events distinguish markup from identical text in CDATA/comments.
 * startTagPosition is pinned to sax@1.6.1 and covered with BOM/position tests.
 * @param {string} xml @param {Policy} policy
 */
export function declarationGuard(xml, { ErrorClass }) {
  let seen = false
  const start = xml.charCodeAt(0) === 0xfeff ? 2 : 1
  /** @param {{name: string, body: string}} declaration @param {unknown} position */
  return (declaration, position) => {
    if (!xmlName.test(declaration.name)) throw new ErrorClass('XML_MALFORMED')
    if (declaration.name.toLowerCase() !== 'xml') return
    if (seen || declaration.name !== 'xml' || position !== start) throw new ErrorClass('XML_MALFORMED')
    seen = true
    // SAX removes leading whitespace, including non-XML whitespace. Check source bytes.
    const end = xml.indexOf('?>', start - 1)
    const sourceBody = xml.slice(start + 4, end)
    if (end < start || !/^[\x20\t\r\n]/.test(sourceBody)) throw new ErrorClass('XML_MALFORMED')
    const match = declarationBody.exec(sourceBody.replace(/^[\x20\t\r\n]+/, ''))
    if (!match) throw new ErrorClass('XML_MALFORMED')
    if (match[2] !== '1.0' || match[4] && !/^utf-8$/i.test(match[4])) {
      throw new ErrorClass('XML_ENCODING_VERSION_UNSUPPORTED')
    }
  }
}

/** Count raw events before SAX's attribute-object overwrite; namespaces are resolved.
 * @param {Policy} policy
 */
export function attributeGuard({ limits, ErrorClass }) {
  let count = 0
  const qualified = new Set()
  const expanded = new Set()
  return {
    reset() { count = 0; qualified.clear(); expanded.clear() },
    /** @param {{name: string, uri: string, local: string}} attribute */
    accept(attribute) {
      if (++count > limits.attributes) throw new ErrorClass('XML_LIMIT')
      const key = JSON.stringify([attribute.uri, attribute.local])
      if (qualified.has(attribute.name) || expanded.has(key)) throw new ErrorClass('XML_MALFORMED')
      qualified.add(attribute.name); expanded.add(key)
    },
  }
}

/** In xmlns mode sax defers attribute events until the whole start tag is read.
 * Bound raw attributes at opentagstart, before sax's quadratic attribList lookup.
 * This scanner only counts lexical attributes; namespace resolution stays in sax.
 * @param {string} xml @param {unknown} position @param {Policy} policy
 */
export function boundRawAttributes(xml, position, { limits, ErrorClass }) {
  if (typeof position !== 'number' || position < 1) throw new ErrorClass('XML_MALFORMED')
  let index = position
  const whitespace = /[\x20\t\r\n]/
  while (index < xml.length && !whitespace.test(xml[index]) && !'/>'.includes(xml[index])) index++
  let count = 0
  const names = new Set()
  while (index < xml.length) {
    while (whitespace.test(xml[index] ?? '')) index++
    if (xml[index] === '>' || xml[index] === '/' && xml[index + 1] === '>') return
    const begin = index
    while (index < xml.length && !whitespace.test(xml[index]) && !'=/>'.includes(xml[index])) index++
    const name = xml.slice(begin, index)
    if (!name) throw new ErrorClass('XML_MALFORMED')
    if (++count > limits.attributes) throw new ErrorClass('XML_LIMIT')
    if (names.has(name)) throw new ErrorClass('XML_MALFORMED')
    names.add(name)
    while (whitespace.test(xml[index] ?? '')) index++
    if (xml[index++] !== '=') throw new ErrorClass('XML_MALFORMED')
    while (whitespace.test(xml[index] ?? '')) index++
    const quote = xml[index++]
    if (quote !== '"' && quote !== "'") throw new ErrorClass('XML_MALFORMED')
    const end = xml.indexOf(quote, index)
    if (end < 0) throw new ErrorClass('XML_MALFORMED')
    index = end + 1
  }
  throw new ErrorClass('XML_MALFORMED')
}

/** Tree infrastructure shared by QA bridges only. Fiscal mapping is never copied.
 * @param {Policy} policy
 */
export function treeBuilder({ limits, ErrorClass }) {
  /** @type {XmlNode[]} */
  const stack = []
  /** @type {XmlNode | undefined} */
  let root
  let count = 0
  /** @type {WeakMap<XmlNode, Map<string, number>>} */
  const occurrences = new WeakMap()
  return {
    /** @param {string} name @param {string} namespace @param {Record<string, string>} attributes */
    open(name, namespace, attributes) {
      if (++count > limits.nodes || stack.length >= limits.depth) throw new ErrorClass('XML_LIMIT')
      const parent = stack[stack.length - 1]
      const counters = parent ? occurrences.get(parent) ?? new Map() : new Map()
      const key = `${namespace}|${name}`
      const ordinal = (counters.get(key) ?? 0) + 1
      counters.set(key, ordinal)
      /** @type {XmlNode} */
      const node = { name, namespace, attributes, children: [], text: '',
        path: `${parent?.path ?? ''}/n:${name}[${ordinal}]` }
      occurrences.set(node, new Map())
      if (parent) parent.children.push(node)
      else if (root) throw new ErrorClass('XML_MULTIPLE_ROOTS')
      else root = node
      stack.push(node)
    },
    /** @param {string} text */
    text(text) { const node = stack[stack.length - 1]; if (node) node.text += text },
    close() { if (!stack.pop()) throw new ErrorClass('XML_MALFORMED') },
    finish() {
      if (!root || stack.length) throw new ErrorClass('XML_MALFORMED')
      return root
    },
  }
}
