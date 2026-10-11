import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { EntityDecoder } from '@nodable/entities'
import { attributeGuard, declarationGuard, treeBuilder, validateInput } from './xml-guards.mjs'

const XML_URI = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_URI = 'http://www.w3.org/2000/xmlns/'
export const FAST_OPTIONS = Object.freeze({ preserveOrder: true, ignoreAttributes: false,
  attributeNamePrefix: '', removeNSPrefix: false, parseTagValue: false, parseAttributeValue: false,
  trimValues: false, processEntities: true, htmlEntities: false, captureMetaData: true,
  ignoreDeclaration: false, ignorePiTags: false })

/** Explicit configuration is separated from guards for native-library diagnostics.
 * @param {import('./xml-guards.mjs').Policy} policy
 */
export function createFastParser({ limits }) {
  const decoder = new EntityDecoder({ numericAllowed: true,
    ncr: { xmlVersion: 1.0, onNCR: 'allow', nullNCR: 'throw' },
    onInputEntity: () => 'throw', onExternalEntity: () => 'throw',
    limit: { maxTotalExpansions: limits.bytes, maxExpandedLength: limits.bytes, applyLimitsTo: 'all' } })
  return new XMLParser({ ...FAST_OPTIONS, maxNestedTags: limits.depth, entityDecoder: decoder })
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Experimental bridge. FXP does not resolve namespace URIs itself.
 * @param {string} xml @param {import('./xml-guards.mjs').Policy} policy
 * @returns {import('./xml-guards.mjs').XmlNode}
 */
export function parseWithFast(xml, policy) {
  validateInput(xml, policy)
  const { ErrorClass } = policy
  const fail = () => { throw new ErrorClass('XML_MALFORMED') }
  if (XMLValidator.validate(xml, { allowBooleanAttributes: false }) !== true) fail()
  const parser = createFastParser(policy)
  /** @type {unknown} */
  let parsed
  try { parsed = parser.parse(xml) }
  catch { throw new ErrorClass('XML_MALFORMED') }
  const tree = treeBuilder(policy)
  const attributes = attributeGuard(policy)
  const declaration = declarationGuard(xml, policy)
  /** @type {unknown} */
  const rawMetadataSymbol = XMLParser.getMetaDataSymbol()
  const metadataSymbol = typeof rawMetadataSymbol === 'symbol' ? rawMetadataSymbol : fail()

  /** @param {string} qualified @returns {{prefix: string, local: string}} */
  const split = qualified => {
    const parts = qualified.split(':')
    if (parts.length > 2 || parts.some(part => !part)) return fail()
    return parts.length === 1 ? { prefix: '', local: parts[0] } : { prefix: parts[0], local: parts[1] }
  }
  /** @param {unknown} input @param {Map<string, string>} inherited */
  const visit = (input, inherited) => {
    if (!Array.isArray(input)) return fail()
    for (const raw of input) {
      if (!isRecord(raw)) return fail()
      const names = Object.keys(raw).filter(key => key !== ':@')
      if (names.length !== 1) return fail()
      const name = names[0]
      if (name === '#text') {
        if (typeof raw[name] !== 'string') return fail()
        tree.text(raw[name]); continue
      }
      if (name.startsWith('?')) {
        const piName = name.slice(1)
        if (piName.toLowerCase() === 'xml') {
          /** @type {unknown} */
          const metadata = Reflect.get(raw, metadataSymbol)
          if (!isRecord(metadata) || typeof metadata.startIndex !== 'number') return fail()
          const start = metadata.startIndex
          const end = xml.indexOf('?>', start)
          if (end < start) return fail()
          const body = xml.slice(start + 2 + piName.length, end).replace(/^[\x20\t\r\n]+/, '')
          declaration({ name: piName, body }, start + 1)
        }
        continue
      }
      const context = new Map(inherited)
      const rawAttributes = raw[':@'] ?? {}
      if (!isRecord(rawAttributes)) return fail()
      for (const [key, value] of Object.entries(rawAttributes)) {
        if (typeof value !== 'string') return fail()
        if (key === 'xmlns' || key.startsWith('xmlns:')) {
          const binding = key === 'xmlns' ? '' : split(key).local
          if (binding === 'xmlns' || value === XMLNS_URI || binding === 'xml' && value !== XML_URI
            || binding !== 'xml' && value === XML_URI || binding && !value) return fail()
          context.set(binding, value)
        }
      }
      attributes.reset()
      /** @type {Record<string, string>} */
      const plain = {}
      for (const [key, value] of Object.entries(rawAttributes)) {
        if (typeof value !== 'string') return fail()
        const { prefix, local } = split(key)
        const uri = key === 'xmlns' || prefix === 'xmlns' ? XMLNS_URI
          : prefix ? context.get(prefix) : ''
        if (uri === undefined) return fail()
        attributes.accept({ name: key, uri, local })
        if (!uri) Object.defineProperty(plain, local, { value, enumerable: true })
      }
      const { prefix, local } = split(name)
      const namespace = context.get(prefix) ?? (prefix ? undefined : '')
      if (namespace === undefined || prefix === 'xmlns') return fail()
      tree.open(local, namespace, plain)
      visit(raw[name], context)
      tree.close()
    }
  }
  visit(parsed, new Map([['xml', XML_URI]]))
  return tree.finish()
}
