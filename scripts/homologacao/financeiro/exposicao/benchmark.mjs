import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const child = spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/homologacao/financeiro/exposicao/benchmark-worker.ts')], {
  cwd: process.cwd(), stdio: 'inherit', env: process.env,
})
if (child.error) throw child.error
if (child.status !== 0) throw new Error(`Benchmark P2.5 encerrou com codigo ${child.status ?? 'desconhecido'}.`)
