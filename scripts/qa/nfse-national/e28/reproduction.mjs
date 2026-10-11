import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parseWithSax as e27 } from '../e27/sax-tree.mjs'
import { parseWithSax as e28 } from './sax-tree.mjs'

const require = createRequire(import.meta.url)
const sax = createRequire(new URL('../e27/sax-tree.mjs', import.meta.url))('sax')
const { parseXmlSafely, XML_LIMITS, NationalXmlError } = require('../../../../src/lib/nfse/xml-nacional/xml-tree')
const policy = { limits: XML_LIMITS, ErrorClass: NationalXmlError }
const engines = {
  native_strict: /** @param {string} xml */ xml => {
    const parser = sax.parser(true, { xmlns: true, strictEntities: true })
    parser.onerror = () => { throw new Error('REJECTED') }
    parser.write(xml).close()
  },
  e27: /** @param {string} xml */ xml => e27(xml, policy),
  e28: /** @param {string} xml */ xml => e28(xml, policy),
  saxes: parseXmlSafely,
}
const observations = ['&AMP;', '&AmP;', '&QUOT;', '&#X41;', '&amp;', '&#x41;'].map(reference => ({ reference,
  results: Object.fromEntries(Object.entries(engines).map(([name, parse]) => {
    try { parse(`<a>${reference}</a>`); return [name, true] }
    catch { return [name, false] }
  })),
}))
const vendor = new URL('../e27/node_modules/sax/lib/sax.js', import.meta.url)
const source = readFileSync(vendor, 'utf8')
if (!source.includes('var entityLC = entity.toLowerCase()') || !source.includes('parser.ENTITIES[entityLC]')) {
  throw new Error('VENDOR_ROOT_CAUSE_CHANGED')
}
writeFileSync(process.argv[2], JSON.stringify({ node: process.version, sax: '1.6.1',
  vendor_sha256: createHash('sha256').update(source).digest('hex'),
  strict_entities_is_not_case_sensitivity: true, observations }, null, 2) + '\n')
