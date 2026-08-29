import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { assertHomologEnvironment, assertMutation, loadHomologEnv, mutationConfirmation, parseArgs } from '../../rlx-golden/helpers.mjs'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const profileOnly = args['profile-only'] === true
const action = profileOnly ? 'PROFILE_P269' : 'BENCHMARK_P269'
if (!assertMutation(args, action, env.projectRef)) {
  console.log(`Preview seguro. O runner executa o pipeline JIT idempotente em homologacao. Confirmacao exigida: ${mutationConfirmation(action, env.projectRef)}`)
  process.exit(0)
}

const warmups = Number(args.warmups ?? (profileOnly ? 1 : 5))
const runs = Number(args.runs ?? (profileOnly ? 3 : 20))
const batch = String(args.batch ?? 'before')
const output = args.output ? resolve(String(args.output)) : null
const operationId = args['operation-id'] ? String(args['operation-id']) : ''
if (!Number.isInteger(warmups) || warmups < (profileOnly ? 1 : 5)) throw new Error(`P2.6.9 exige pelo menos ${profileOnly ? 1 : 5} warm-up(s) neste modo.`)
if (!Number.isInteger(runs) || runs < (profileOnly ? 3 : 20)) throw new Error(`P2.6.9 exige pelo menos ${profileOnly ? 3 : 20} run(s) neste modo.`)
if (!['before', 'after', 'confirmation'].includes(batch)) throw new Error('Batch deve ser before, after ou confirmation.')

const shimRoot = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'node-shims')
const shimPackage = resolve(shimRoot, 'server-only')
mkdirSync(shimPackage, { recursive: true })
writeFileSync(resolve(shimPackage, 'package.json'), '{"name":"server-only","version":"0.0.0","main":"index.js"}\n')
writeFileSync(resolve(shimPackage, 'index.js'), 'module.exports = {}\n')

const child = spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/homologacao/financeiro/risco/benchmark-worker.ts')], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_PATH: [shimRoot, process.env.NODE_PATH].filter(Boolean).join(delimiter),
    BW_BENCHMARK_WARMUPS: String(warmups),
    BW_BENCHMARK_RUNS: String(runs),
    BW_BENCHMARK_BATCH: batch,
    BW_BENCHMARK_OPERATION_ID: operationId,
    BW_BENCHMARK_PROFILE_ONLY: profileOnly ? '1' : '0',
  },
  encoding: 'utf8',
  timeout: 900_000,
  maxBuffer: 32 * 1024 * 1024,
})
if (child.error) throw child.error
if (child.status !== 0) throw new Error(child.stderr || `Benchmark P2.6.9 encerrou com codigo ${child.status ?? 'desconhecido'}.`)
const result = JSON.parse(child.stdout)
if (output) {
  mkdirSync(resolve(output, '..'), { recursive: true })
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}
console.log(JSON.stringify({
  output,
  batch: result.batch,
  benchmark_case_id: result.workload?.benchmark_case_id,
  warmups: result.protocol?.warmups_executed,
  runs: result.protocol?.measured_runs,
  total_ms: result.stats?.totalMs,
  requests: result.request_stats?.total,
  errors: result.stability?.errors,
}, null, 2))
