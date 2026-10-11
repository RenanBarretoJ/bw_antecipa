import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { canonicalSchema } from '../../../../src/lib/nfse/canonical/schema'
import { canonicalFields, loadStructuralCorpus, valueAt } from '../../../../src/lib/nfse/xml-nacional/corpus'

const holder = vi.hoisted(() => {
  /** @type {{parse?: typeof import('../../../../src/lib/nfse/xml-nacional/xml-tree').parseXmlSafely}} */
  const reference = {}
  return reference
})
vi.mock('../../../../src/lib/nfse/xml-nacional/xml-tree', async importOriginal => {
  const original = /** @type {typeof import('../../../../src/lib/nfse/xml-nacional/xml-tree')} */ (await importOriginal())
  holder.parse = original.parseXmlSafely
  const engine = process.env.BW_NFSE_E28_PARSER ?? 'saxes'
  if (engine === 'saxes' || engine === 'sax-e27') return original
  if (!['sax'].includes(engine)) throw new Error('QA_ENGINE_INVALID')
  const { parseWithSax } = await import('./sax-tree.mjs')
  /** @type {typeof original.parseXmlSafely} */
  const parseXmlSafely = xml => parseWithSax(xml, {
    limits: original.XML_LIMITS, ErrorClass: original.NationalXmlError,
  })
  return { ...original, parseXmlSafely }
})
import { extractNationalXml } from '../../../../src/lib/nfse/xml-nacional/adapter'
import { parseXmlSafely, NationalXmlError } from '../../../../src/lib/nfse/xml-nacional/xml-tree'

const engine = process.env.BW_NFSE_E28_PARSER ?? 'saxes'
const output = process.env.BW_NFSE_E28_OUTPUT
const prior = process.env.BW_NFSE_E25_PRIVATE
if (!output || !prior) throw new Error('QA_PRIVATE_DIRECTORIES_REQUIRED')
const referenceSchema = z.object({ structural: z.array(z.object({ id: z.string(), result: z.unknown() })),
  public_samples: z.array(z.object({ id: z.string(), result: z.unknown() })) })
const reference = referenceSchema.parse(JSON.parse(readFileSync(join(prior, 'adapter-saxes.json'), 'utf8')))
const references = new Map([...reference.structural, ...reference.public_samples].map(row => [row.id, row.result]))
const publicSchema = z.array(z.object({ id: z.string(), sha256: z.string(), classification: z.string(),
  local_private_path: z.string(), version: z.string().nullable() }))
const structural = loadStructuralCorpus()
const corpus = structural.map(({ entry, xml, expected }) => ({ id: entry.id, classification: entry.origem,
  version: entry.versao, xml, sha256: entry.sha256, expected }))
const publicCorpus = publicSchema.parse(JSON.parse(readFileSync(join(prior, 'public-samples.json'), 'utf8')))
/** @type {Record<string, unknown>[]} */
const observations = []
/** @type {Record<string, unknown>[]} */
const summary = []
/** Object property order is not XML structure. Array order remains significant.
 * @param {unknown} value @returns {unknown}
 */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]))
  return value
}
/** @param {unknown} value */
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')

/** @param {string} xml */
function treeObservation(xml) {
  try { return { accepted: true, tree: parseXmlSafely(xml), code: null } }
  catch (caught) { return { accepted: false, tree: null,
    code: caught instanceof NationalXmlError ? caught.code : 'UNEXPECTED_POC_ERROR' } }
}

describe(`Canonical comparison without domain changes: ${engine}`, () => {
  const all = [...corpus, ...publicCorpus.map(entry => ({ ...entry,
    xml: readFileSync(entry.local_private_path, 'utf8'), expected: null }))]
  for (const entry of all) {
    it(`corpus: ${entry.id}`, () => {
      expect(createHash('sha256').update(entry.xml).digest('hex')).toBe(entry.sha256)
      const cpu = process.cpuUsage()
      const begin = performance.now()
      const result = extractNationalXml(entry.xml)
      const elapsed = performance.now() - begin
      const usage = process.cpuUsage(cpu)
      const expected = references.get(entry.id)
      if (!expected || !holder.parse) throw new Error('QA_REFERENCE_MISSING')
      const treeResult = treeObservation(entry.xml)
      /** @type {unknown} */
      let referenceTree
      try { referenceTree = holder.parse(entry.xml) }
      catch { referenceTree = null }
      const fieldResults = result.resultado === 'RECONHECIDO' && entry.expected
        ? Object.entries(entry.expected.campos).map(([key, value]) => ({ field: key,
          matched: JSON.stringify(valueAt(result.documento, key)) === JSON.stringify(value)
            || valueAt(result.documento, `${key}.estado`) === value.estado
              && valueAt(result.documento, `${key}.valor`) === value.valor })) : []
      const completeMatched = hash(result) === hash(expected)
      const treeMatched = hash(treeResult.tree) === hash(referenceTree)
      const actualFields = result.resultado === 'RECONHECIDO' ? canonicalFields(result.documento) : []
      const referenceFields = canonicalFields(valueAt(expected, 'documento'))
      const fieldComparison = referenceFields.map(field => {
        const actual = valueAt(result, `documento.${field.caminho}`)
        const referenceValue = valueAt(expected, `documento.${field.caminho}`)
        return { field: field.caminho, expected_state: field.estado,
          actual_state: valueAt(actual, 'estado') ?? null,
          value_matched: hash(valueAt(actual, 'valor') ?? null) === hash(field.valor),
          complete_field_matched: hash(actual ?? null) === hash(referenceValue),
          expected_field_sha256: hash(referenceValue), actual_field_sha256: hash(actual ?? null) }
      })
      observations.push({ id: entry.id, classification: entry.classification, version: entry.version,
        sha256: entry.sha256, result, tree: treeResult.tree, fields: actualFields })
      summary.push({ id: entry.id, classification: entry.classification, version: entry.version,
        source_sha256: entry.sha256, result: result.resultado,
        code: result.resultado !== 'RECONHECIDO' ? result.codigo : null,
        canonical_sha256: hash(result), canonical_reference_sha256: hash(expected), complete_matched: completeMatched,
        tree_sha256: hash(treeResult.tree), tree_reference_sha256: hash(referenceTree), tree_matched: treeMatched,
        canonical_fields: actualFields.length, field_comparison: fieldComparison,
        trace_sha256: hash(actualFields.map(field => {
          const full = valueAt(result, `documento.${field.caminho}`)
          return ['original', 'origem', 'metodo', 'evidencias', 'derivacao'].map(key => valueAt(full, key))
        })),
        synthetic_fields: fieldResults, wall_ms: elapsed, cpu_us: usage.user + usage.system })
      expect(treeMatched, 'Namespace, strings, order and paths must match').toBe(true)
      expect(completeMatched, 'Complete canonical output, values and provenance must match').toBe(true)
      if (result.resultado === 'RECONHECIDO') expect(canonicalSchema.safeParse(result.documento).success).toBe(true)
      expect(fieldResults.every(field => field.matched)).toBe(true)
    })
  }
})
afterAll(() => {
  writeFileSync(join(output, `corpus-private-${engine}.json`), JSON.stringify({ node: process.version, engine, observations }, null, 2) + '\n')
  writeFileSync(join(output, `corpus-summary-${engine}.json`), JSON.stringify({ node: process.version, engine,
    certified_fiscal_documents: 0, fiscal_precision: null, fiscal_recall: null, observations: summary }, null, 2) + '\n')
})
