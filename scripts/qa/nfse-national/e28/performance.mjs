import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { z } from 'zod'
import { parseWithSax } from './sax-tree.mjs'

const require = createRequire(import.meta.url)
const { NationalXmlError, parseXmlSafely, XML_LIMITS } = /** @type {typeof import('../../../../src/lib/nfse/xml-nacional/xml-tree')} */ (
  require('../../../../src/lib/nfse/xml-nacional/xml-tree.ts')
)
const [engine, workload] = z.tuple([z.enum(['saxes', 'sax']), z.enum([
  'document', 'nodes', 'large-text', 'depth', 'depth-over', 'nodes-over', 'attributes-over',
  'bytes-over', 'attack-depth', 'attack-nodes', 'attack-attributes', 'references', 'numeric-zeros', 'unknown-long',
])]).parse(process.argv.slice(2))
const policy = { limits: XML_LIMITS, ErrorClass: NationalXmlError }
/** @type {(input: string) => unknown} */
const parse = engine === 'saxes' ? parseXmlSafely : input => parseWithSax(input, policy)
const inputs = {
  document: () => readFileSync('tests/fixtures/nfse/nacional/nfse-1-01.xml', 'utf8'),
  nodes: () => '<a>' + '<b/>'.repeat(XML_LIMITS.nodes - 1) + '</a>',
  'large-text': () => '<a>' + 'x'.repeat(18 * 1024 * 1024) + '</a>',
  references: () => '<a x="&amp;">' + '&amp;&#65;&#x42;'.repeat(20000) + '</a>',
  'numeric-zeros': () => '<a>&#' + '0'.repeat(1000000) + '65;</a>',
  'unknown-long': () => '<a>&' + 'u'.repeat(18 * 1024 * 1024) + ';</a>',
  depth: () => '<a>'.repeat(XML_LIMITS.depth) + '</a>'.repeat(XML_LIMITS.depth),
  'depth-over': () => '<a>'.repeat(XML_LIMITS.depth + 1) + '</a>'.repeat(XML_LIMITS.depth + 1),
  'nodes-over': () => '<a>' + '<b/>'.repeat(XML_LIMITS.nodes) + '</a>',
  'attributes-over': () => '<a ' + Array.from({ length: XML_LIMITS.attributes + 1 }, (_, i) => `x${i}="1"`).join(' ') + '/>',
  'bytes-over': () => '<a>' + 'x'.repeat(XML_LIMITS.bytes) + '</a>',
  'attack-depth': () => '<a>'.repeat(100000) + '</a>'.repeat(100000),
  'attack-nodes': () => '<a>' + '<b/>'.repeat(500000) + '</a>',
  'attack-attributes': () => '<a ' + Array.from({ length: 100000 }, (_, i) => `x${i}="1"`).join(' ') + '/>',
}
const xml = inputs[workload]()
const expectedAccepted = ['document', 'nodes', 'large-text', 'depth', 'references', 'numeric-zeros'].includes(workload)
const repetitions = workload === 'document' ? 100 : workload.includes('large-text') ? 3 : expectedAccepted ? 10 : 1
/** @type {string | null} */
let error = null
/** @type {number[]} */
const timings = []
const startCpu = process.cpuUsage()
/** @param {string} input */
function observe(input) {
  const start = performance.now()
  try { parse(input) }
  catch (caught) { error = caught instanceof NationalXmlError ? caught.code : 'UNEXPECTED_POC_ERROR' }
  timings.push(performance.now() - start)
}
if (expectedAccepted) {
  for (let index = 0; index < 3; index++) observe(xml)
  timings.length = 0
}
global.gc?.()
const initial = process.memoryUsage()
for (let index = 0; index < repetitions && (!expectedAccepted || !error); index++) observe(xml)
const end = process.memoryUsage()
const cpu = process.cpuUsage(startCpu)
global.gc?.()
const sorted = [...timings].sort((left, right) => left - right)
process.stdout.write(JSON.stringify({ node: process.version, engine, workload, expected_accepted: expectedAccepted,
  accepted: error === null, code: error, repetitions: timings.length,
  input_bytes: Buffer.byteLength(xml), median_ms: sorted[Math.floor(sorted.length / 2)] ?? null,
  p95_ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
  total_wall_ms: timings.reduce((sum, number) => sum + number, 0),
  cpu_user_us: cpu.user, cpu_system_us: cpu.system, cpu_includes_warmup: true,
  initial_rss: initial.rss, final_rss: end.rss, heap_before: initial.heapUsed, heap_after: end.heapUsed,
  heap_after_gc: process.memoryUsage().heapUsed, max_rss_kib: process.resourceUsage().maxRSS,
  gc_exposed: Boolean(global.gc), scope: 'XML_TREE_ONLY_FRESH_PROCESS_WITH_TSX_STARTUP' }) + '\n')
