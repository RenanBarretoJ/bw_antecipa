import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const child = spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/homologacao/financeiro/readiness/benchmark-worker.ts')], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 600_000,
  maxBuffer: 16 * 1024 * 1024,
})
if (child.error) throw child.error
if (child.status !== 0) throw new Error(child.stderr || `Benchmark encerrou com codigo ${child.status}`)
const parsed = JSON.parse(child.stdout)
const target = resolve('docs/financeiro/performance-p2-6-1.json')
writeFileSync(target, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ target, results: parsed.results }, null, 2))
