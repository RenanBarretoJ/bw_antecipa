import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseXmlSafely, NationalXmlError, XML_LIMITS } from '../../../../src/lib/nfse/xml-nacional/xml-tree'
import { parseWithSax } from './sax-tree.mjs'
import { parseWithFast } from './fast-tree.mjs'
import { parseWithSax as parseUncorrected } from '../e25/sax-tree.mjs'
import { securityCases } from './cases.mjs'

const engine = process.env.BW_NFSE_E27_PARSER ?? 'saxes'
if (!['saxes', 'sax', 'fast', 'sax-e25'].includes(engine)) throw new Error('QA_ENGINE_INVALID')
const policy = { limits: XML_LIMITS, ErrorClass: NationalXmlError }
/** @type {(xml: string) => ReturnType<typeof parseXmlSafely>} */
const parse = engine === 'saxes' ? parseXmlSafely : engine === 'sax' ? xml => parseWithSax(xml, policy)
  : engine === 'fast' ? xml => parseWithFast(xml, policy) : xml => parseUncorrected(xml, policy)
/** @type {Record<string, unknown>[]} */
const observations = []
describe(`XML security gate: ${engine}`, () => {
  for (const vector of securityCases(XML_LIMITS)) {
    it(`${vector.family}: ${vector.id}`, () => {
      /** @type {ReturnType<typeof parseXmlSafely> | undefined} */
      let tree
      /** @type {string | null} */
      let error = null
      try { tree = parse(vector.xml) }
      catch (caught) { error = caught instanceof NationalXmlError ? caught.code : 'UNEXPECTED_POC_ERROR' }
      const passed = Boolean(tree) === vector.accepted && (!vector.code || error === vector.code)
        && (vector.text === undefined || tree?.text === vector.text)
        && (vector.attribute === undefined || tree?.attributes.x === vector.attribute)
      observations.push({ id: vector.id, family: vector.family, expected_accepted: vector.accepted,
        accepted: Boolean(tree), expected_code: vector.code ?? null, code: error, passed,
        tree_sha256: tree ? createHash('sha256').update(JSON.stringify(tree)).digest('hex') : null })
      expect(Boolean(tree), 'Prohibited XML must not reach mapping').toBe(vector.accepted)
      if (vector.code) expect(error).toBe(vector.code)
      if (vector.text !== undefined) expect(tree?.text).toBe(vector.text)
      if (vector.attribute !== undefined) expect(tree?.attributes.x).toBe(vector.attribute)
    })
  }
})
afterAll(() => {
  const output = process.env.BW_NFSE_E27_OUTPUT
  if (output) writeFileSync(join(output, `security-${engine}.json`), JSON.stringify({ node: process.version,
    engine, collection_success_is_not_security_pass: true, observations }, null, 2) + '\n')
})
