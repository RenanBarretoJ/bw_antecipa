import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { initializeMutation } from './runtime.mjs'

const { args, env, execute, confirmation } = initializeMutation('INGEST_V2')
if (!execute) {
  console.log(`Preview seguro no projeto ${env.projectRef}. Para executar: --execute --expected-project-ref ${env.projectRef} --confirm ${confirmation}`)
  process.exit(0)
}
const phase = String(args.phase || 'initial')
if (!['initial', 'rectify'].includes(phase)) throw new Error('Use --phase initial ou --phase rectify.')
const tsx = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs')
const worker = resolve(process.cwd(), 'scripts/homologacao/rlx-golden-v2/ingest-worker.ts')
const child = spawnSync(process.execPath, [tsx, worker, `--phase=${phase}`], { cwd: process.cwd(), env: process.env, stdio: 'inherit' })
if (child.error) throw child.error
if (child.status !== 0) throw new Error(`Worker P2.2/V2 encerrou com codigo ${child.status ?? 'desconhecido'}.`)
