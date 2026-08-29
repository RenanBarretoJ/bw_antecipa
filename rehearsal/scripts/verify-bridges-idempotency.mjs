import path from 'node:path'
import {
  REPORT_DIR,
  REPOSITORY_ROOT,
  assertLocalTarget,
  formatError,
  run,
  writeJson,
} from './lib.mjs'
import { collectPostUpgrade } from './post-upgrade-local.mjs'

const LOCAL_DB_CONTAINER = 'supabase_db_bw-antecipa-prod-rehearsal'
const CONTAINER_MIGRATION = '/tmp/bw-antecipa-bridge-idempotency.sql'
const BRIDGES = [
  '20260827183411_bridge_consultor_cedentes_para_consultor_cedente.sql',
  '20260827184403_bridge_documentos_representante_legado.sql',
  '20260827185557_bridge_remover_policies_legadas_gestor_global.sql',
]

function applyBridge(fileName) {
  const source = path.join(REPOSITORY_ROOT, 'supabase', 'migrations', fileName)
  run('docker', ['cp', source, `${LOCAL_DB_CONTAINER}:${CONTAINER_MIGRATION}`])
  try {
    run('docker', [
      'exec', LOCAL_DB_CONTAINER,
      'psql',
      '--username=supabase_admin',
      '--dbname=postgres',
      '--set=ON_ERROR_STOP=1',
      '--single-transaction',
      '--file', CONTAINER_MIGRATION,
    ])
  } finally {
    run('docker', ['exec', LOCAL_DB_CONTAINER, 'rm', '-f', CONTAINER_MIGRATION])
  }
}

try {
  assertLocalTarget()
  const before = await collectPostUpgrade()
  if (before.hard_failures.length > 0) throw new Error('Estado anterior possui falhas bloqueantes.')
  for (let round = 1; round <= 2; round += 1) {
    for (const bridge of BRIDGES) applyBridge(bridge)
  }
  const after = await collectPostUpgrade()
  const idempotent = after.hard_failures.length === 0
    && before.deterministic_hash === after.deterministic_hash
  const report = {
    generated_at: new Date().toISOString(),
    bridges: BRIDGES,
    rounds: 2,
    before_hash: before.deterministic_hash,
    after_hash: after.deterministic_hash,
    hard_failures: after.hard_failures,
    idempotent,
  }
  writeJson(path.join(REPORT_DIR, 'bridge-idempotency.json'), report)
  if (!idempotent) throw new Error('Reaplicacao das bridges alterou o estado logico final.')
  console.log(`BRIDGES_IDEMPOTENTES = CONFIRMADO (${after.deterministic_hash})`)
} catch (error) {
  console.error(`Validacao de idempotencia das bridges falhou: ${formatError(error)}`)
  process.exitCode = 1
}
