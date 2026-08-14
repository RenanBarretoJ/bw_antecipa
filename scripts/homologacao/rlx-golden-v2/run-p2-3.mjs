import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { initializeMutation } from './runtime.mjs'

const { args, env, execute, confirmation } = initializeMutation('RUN_P23_V2')
if (!execute) {
  console.log(`Preview seguro no projeto ${env.projectRef}. Para executar: --execute --expected-project-ref ${env.projectRef} --confirm ${confirmation}`)
  process.exit(0)
}
const phase = String(args.phase || 'A').toUpperCase()
if (!['A', 'B'].includes(phase)) throw new Error('Use --phase A ou --phase B.')
const tsx = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs')
const worker = resolve(process.cwd(), 'scripts/homologacao/rlx-golden-v2/run-p2-3-worker.ts')
// `server-only` e uma sentinela do bundler Next, nao uma dependencia de runtime.
// O worker Node recebe um shim efemero para executar exatamente o modulo server-side real.
const shimRoot = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'node-shims')
const shimPackage = resolve(shimRoot, 'server-only')
mkdirSync(shimPackage, { recursive: true })
writeFileSync(resolve(shimPackage, 'package.json'), '{"name":"server-only","version":"0.0.0","main":"index.js"}\n')
writeFileSync(resolve(shimPackage, 'index.js'), 'module.exports = {}\n')
const childEnv = { ...process.env, NODE_PATH: [shimRoot, process.env.NODE_PATH].filter(Boolean).join(delimiter) }
const child = spawnSync(process.execPath, [tsx, worker, `--phase=${phase}`], { cwd: process.cwd(), env: childEnv, stdio: 'inherit' })
if (child.error) throw child.error
if (child.status !== 0) throw new Error(`Worker P2.3/V2 encerrou com codigo ${child.status ?? 'desconhecido'}.`)
