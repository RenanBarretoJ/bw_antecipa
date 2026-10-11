import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { z } from 'zod'
import { parseWithSax } from './sax-tree.mjs'

const require = createRequire(import.meta.url)
const { NationalXmlError, parseXmlSafely, XML_LIMITS } = /** @type {typeof import('../../../../src/lib/nfse/xml-nacional/xml-tree')} */ (
  require('../../../../src/lib/nfse/xml-nacional/xml-tree.ts')
)

const options = z.tuple([z.enum(['saxes', 'sax']), z.enum(['document', 'nodes', 'large-text', 'depth'])]).parse(process.argv.slice(2))
const [engine, workload] = options
const inputs = {
  document: readFileSync('tests/fixtures/nfse/nacional/nfse-1-01.xml', 'utf8'),
  nodes: '<a>'+'<b/>'.repeat(XML_LIMITS.nodes-1)+'</a>',
  'large-text': '<a>'+'x'.repeat(18*1024*1024)+'</a>',
  depth: '<a>'.repeat(XML_LIMITS.depth)+'</a>'.repeat(XML_LIMITS.depth),
}
const xml = inputs[workload]
/** @param {string} input */
const candidateParse = input => parseWithSax(input, {
  limits: XML_LIMITS, ErrorClass: NationalXmlError,
})
const parse = engine === 'saxes' ? parseXmlSafely : candidateParse
const repetitions = workload === 'document' ? 100 : workload === 'large-text' ? 3 : 10
/** @type {string | null} */
let error = null
try {
  for (let i = 0; i < 3; i++) parse(xml)
} catch (caught) { error = caught instanceof NationalXmlError ? caught.code : 'UNEXPECTED_POC_ERROR' }
global.gc?.()
const initialMemory = process.memoryUsage()
const cpu = process.cpuUsage()
/** @type {number[]} */
const timings = []
if (!error) {
  for (let i = 0; i < repetitions; i++) {
    const begin = performance.now()
    try { parse(xml) }
    catch (caught) { error = caught instanceof NationalXmlError ? caught.code : 'UNEXPECTED_POC_ERROR'; break }
    timings.push(performance.now()-begin)
  }
}
const cpuElapsed = process.cpuUsage(cpu)
const endMemory = process.memoryUsage()
global.gc?.()
const sorted = [...timings].sort((a, b) => a-b)
console.log(JSON.stringify({ node: process.version, engine, workload, input_bytes: Buffer.byteLength(xml),
  repetitions: timings.length, error, median_ms: sorted[Math.floor(sorted.length/2)] ?? null,
  p95_ms: sorted[Math.min(sorted.length-1, Math.ceil(sorted.length*0.95)-1)] ?? null,
  total_wall_ms: timings.reduce((sum, n) => sum+n, 0), cpu_user_us: cpuElapsed.user, cpu_system_us: cpuElapsed.system,
  initial_rss: initialMemory.rss, final_rss: endMemory.rss, heap_before: initialMemory.heapUsed,
  heap_after: endMemory.heapUsed, heap_after_gc: process.memoryUsage().heapUsed,
  max_rss_kib: process.resourceUsage().maxRSS, gc_exposed: Boolean(global.gc),
  measurement_scope: 'RAW_XML_TREE_ONLY_FRESH_PROCESS_WITH_TSX_STARTUP',
}))
