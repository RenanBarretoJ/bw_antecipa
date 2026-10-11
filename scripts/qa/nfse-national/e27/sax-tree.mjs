import sax from 'sax'
import { attributeGuard, boundRawAttributes, declarationGuard, treeBuilder, validateInput } from './xml-guards.mjs'

/** Corrective PoC only; no import from the application to this module.
 * @param {string} xml @param {import('./xml-guards.mjs').Policy} policy
 * @returns {import('./xml-guards.mjs').XmlNode}
 */
export function parseWithSax(xml, policy) {
  validateInput(xml, policy)
  const { ErrorClass } = policy
  /** @type {import('sax').SAXOptions & {strictEntities: boolean}} */
  const options = { xmlns: true, strictEntities: true, trim: false, normalize: false, position: true }
  const parser = sax.parser(true, options)
  const tree = treeBuilder(policy)
  const attributes = attributeGuard(policy)
  const declaration = declarationGuard(xml, policy)
  parser.onerror = () => { throw new ErrorClass('XML_MALFORMED') }
  parser.ondoctype = () => { throw new ErrorClass('XML_DTD_FORBIDDEN') }
  parser.onopentagstart = () => {
    boundRawAttributes(xml, Reflect.get(parser, 'startTagPosition'), policy)
    attributes.reset()
  }
  parser.onattribute = attribute => {
    if (typeof attribute === 'string' || !('uri' in attribute) || typeof attribute.uri !== 'string'
      || !('local' in attribute) || typeof attribute.local !== 'string') throw new ErrorClass('XML_NAMESPACE_CONFLICT')
    attributes.accept({ name: attribute.name, uri: attribute.uri, local: attribute.local })
  }
  parser.onprocessinginstruction = instruction => declaration(instruction, Reflect.get(parser, 'startTagPosition'))
  parser.onopentag = tag => {
    if (!('uri' in tag)) throw new ErrorClass('XML_NAMESPACE_CONFLICT')
    const plain = Object.fromEntries(Object.values(tag.attributes).filter(attribute => !attribute.uri)
      .map(attribute => [attribute.local, attribute.value]))
    tree.open(tag.local, tag.uri, plain)
  }
  parser.ontext = text => tree.text(text)
  parser.oncdata = text => tree.text(text)
  parser.onclosetag = () => tree.close()
  parser.write(xml).close()
  return tree.finish()
}
