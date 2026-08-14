import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { assertHomologEnvironment, assertMutation, loadHomologEnv, mutationConfirmation, parseArgs } from '../rlx-golden/helpers.mjs'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const action = 'RUN_P24_V2'
if (!assertMutation(args, action, env.projectRef)) {
  console.log(`Preview seguro. Para executar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation(action, env.projectRef)}`)
  process.exit(0)
}
const shimRoot = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'node-shims')
const shimPackage = resolve(shimRoot, 'server-only')
mkdirSync(shimPackage, { recursive: true })
writeFileSync(resolve(shimPackage, 'package.json'), '{"name":"server-only","version":"0.0.0","main":"index.js"}\n')
writeFileSync(resolve(shimPackage, 'index.js'), 'module.exports = {}\n')
const child = spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/homologacao/rlx-logistica-financeira/run-worker.ts')], {
  cwd: process.cwd(), env: { ...process.env, NODE_PATH: [shimRoot, process.env.NODE_PATH].filter(Boolean).join(delimiter) }, stdio: 'inherit',
})
if (child.error) throw child.error
if (child.status !== 0) throw new Error(`Worker P2.4 encerrou com codigo ${child.status ?? 'desconhecido'}.`)
