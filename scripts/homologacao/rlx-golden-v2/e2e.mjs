import { spawnSync } from 'node:child_process'
import { assertHomologEnvironment, assertMutation, loadHomologEnv, mutationConfirmation, parseArgs } from '../rlx-golden/helpers.mjs'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const execute = assertMutation(args, 'E2E_V2', env.projectRef)

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: process.cwd(), env: process.env, stdio: 'inherit', shell: false })
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} falhou com exit code ${result.status}`)
}

if (!execute) {
  run(process.execPath, ['scripts/homologacao/rlx-golden-v2/generate.mjs', '--check'])
  console.log(`Dry-run E2E aprovado. Para executar em homolog: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation('E2E_V2', env.projectRef)}`)
} else {
  const safe = (action) => ['--execute', '--expected-project-ref', env.projectRef, '--confirm', mutationConfirmation(action, env.projectRef)]
  run(process.execPath, ['scripts/homologacao/rlx-golden-v2/generate.mjs', '--check'])
  run(process.execPath, ['scripts/homologacao/rlx-golden-v2/seed.mjs', ...safe('SEED_V2')])
  run(process.execPath, ['scripts/homologacao/rlx-golden-v2/ingest.mjs', '--phase', 'initial', ...safe('INGEST_V2')])
  run(process.execPath, ['scripts/homologacao/rlx-golden-v2/run-p2-3.mjs', '--phase', 'A', ...safe('RUN_P23_V2')])
  run(process.execPath, ['scripts/homologacao/rlx-golden-v2/ingest.mjs', '--phase', 'rectify', ...safe('INGEST_V2')])
  run(process.execPath, ['scripts/homologacao/rlx-golden-v2/run-p2-3.mjs', '--phase', 'B', ...safe('RUN_P23_V2')])
  run(process.execPath, ['scripts/homologacao/rlx-golden-v2/verify.mjs', '--expected-project-ref', env.projectRef])
  run(process.execPath, ['scripts/homologacao/rlx-golden-v2/verify-security.mjs', '--expected-project-ref', env.projectRef])
  console.log('Golden V2 E2E concluido. A massa foi mantida em homolog para QA.')
}
