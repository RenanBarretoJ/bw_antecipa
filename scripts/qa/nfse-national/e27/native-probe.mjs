import { XMLValidator } from 'fast-xml-parser'
import sax from 'sax'
import { createFastParser } from './fast-tree.mjs'

/** @type {import('./xml-guards.mjs').Policy} */
const policy = { limits: { bytes: 20971520, depth: 64, nodes: 50000, attributes: 64 }, ErrorClass: Error }
const cases = {
  duplicate_attributes: '<a v="1" v="2"/>', control_literal: '<a>\u0001</a>',
  duplicate_declaration: '<?xml version="1.0"?><?xml version="1.0"?><a/>',
  case_sensitive_entity: '<a>&AMP;</a>', unknown_entity: '<a>&unknown;</a>',
  html_entity: '<a>&copy;</a>', numeric_control: '<a>&#x1;</a>',
  numeric_surrogate: '<a>&#xD800;</a>', numeric_overflow: '<a>&#x110000;</a>',
  numeric_fffe: '<a>&#xFFFE;</a>', invalid_comment: '<a><!--a--b--></a>',
}
const observations = Object.entries(cases).map(([id, xml]) => {
  /** @type {unknown} */
  let fastTree = null
  let fastAccepted = false
  try {
    if (XMLValidator.validate(xml) === true) { fastTree = createFastParser(policy).parse(xml); fastAccepted = true }
  } catch { fastAccepted = false }
  /** @type {import('sax').SAXOptions & {strictEntities: boolean}} */
  const options = { xmlns: true, strictEntities: true }
  const parser = sax.parser(true, options)
  parser.onerror = () => { throw new Error('XML_MALFORMED') }
  let saxAccepted = false
  try { parser.write(xml).close(); saxAccepted = true } catch { saxAccepted = false }
  return { id, sax_native_accepted: saxAccepted, fast_native_validator_parser_accepted: fastAccepted,
    fast_native_output: fastTree }
})
process.stdout.write(JSON.stringify({ node: process.version, scope: 'FICTIONAL_STRUCTURAL_INPUTS_ONLY_NO_E27_GUARDS', observations }, null, 2) + '\n')
