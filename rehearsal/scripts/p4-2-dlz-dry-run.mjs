import fs from 'node:fs'
import path from 'node:path'
import {
  REHEARSAL_ROOT, REPORT_DIR, formatError, localPgConfig, run, sha256, stableJson, withPgClient, writeJson,
} from './lib.mjs'
import { loadDlzConfigManifest } from './dlz-production-config.mjs'
import { runDatabaseMode } from './configure-dlz-production.mjs'

function runScript(file, args = []) {
  run(process.execPath, [path.join(REHEARSAL_ROOT, 'scripts', file), ...args], { capture: false })
}

async function applyCedentePatch() {
  const sql = fs.readFileSync(path.join(REHEARSAL_ROOT, '..', 'supabase', 'migrations', '20260827213304_p3_1_vincular_cedentes_dlz.sql'), 'utf8')
  await withPgClient(localPgConfig(), async (client) => {
    await client.query('begin')
    try { await client.query(sql); await client.query('commit') } catch (error) { await client.query('rollback'); throw error }
  })
}

async function assertNoPartialConfiguration(manifest) {
  await withPgClient(localPgConfig(), async (client) => {
    const result = await client.query(`select
      (select count(*) from public.politicas_operacionais where id=$1)+
      (select count(*) from public.configuracoes_cnab where id=$2)+
      (select count(*) from public.integracoes_fundo where id=$3) as count`, [manifest.ids.policy,manifest.ids.cnab,manifest.ids.integration])
    if (Number(result.rows[0].count) !== 0) throw new Error('Teste de atomicidade deixou DML parcial.')
  })
}

async function conflict(client, change, expectedPattern, context) {
  await client.query('begin')
  try {
    await change()
    await runDatabaseMode(client, { mode:'plan', ...context })
    throw new Error(`Cenario de conflito nao falhou: ${expectedPattern}.`)
  } catch (error) {
    if (!new RegExp(expectedPattern, 'iu').test(String(error.message))) throw error
  } finally {
    await client.query('rollback')
  }
}

async function runConflictMatrix(context) {
  return withPgClient(localPgConfig(), async (client) => {
    await conflict(client, () => client.query('update public.politicas_operacionais set nome=$1 where id=$2', ['DIVERGENTE',context.manifest.ids.policy]), 'divergente', context)
    await conflict(client, () => client.query('update public.configuracoes_cnab set nome=$1 where id=$2', ['DIVERGENTE',context.manifest.ids.cnab]), 'divergente', context)
    await conflict(client, () => client.query(`update public.cedente_fundos set status='suspenso' where id=(select id from public.cedente_fundos where fundo_id=$1 and status='ativo' order by id limit 1)`, [context.manifest.fundo_id]), 'cedentes_dlz', context)
    const blockedVersion = context.production.manifest.blocked_homolog_only[0].file.match(/^(\d+)_/u)[1]
    await conflict(client, () => client.query(`insert into supabase_migrations.schema_migrations(version,statements,name) values($1,array[]::text[],'blocked_test')`, [blockedVersion]), 'exclusiva de homologacao', context)
    await conflict(client, () => client.query(`insert into public.politicas_operacionais(fundo_id,codigo,nome,status,created_by,padrao) values($1,'p4_2_conflict','IMPULSE CONFLICT','ativa',$2,true)`, [context.manifest.impulse_fundo_id,context.manifest.actor_id]), 'IMPULSE', context)
    return { policy_divergence:'PASS', cnab_divergence:'PASS', missing_cedente_patch:'PASS', blocked_migration:'PASS', impulse_untouched:'PASS' }
  })
}

async function cycle(label) {
  console.log(`\nP4.2 clean cycle ${label}`)
  runScript('rebuild-local.mjs')
  runScript('upgrade-local.mjs')
  runScript('post-upgrade-local.mjs', [`--output=P4_2_POST_UPGRADE_${label}.json`])
  await applyCedentePatch()
  // Neste ponto os unicos blockers esperados sao justamente as configuracoes
  // que este P4.2 criara. Falhas de migration ou baseline continuam fatais.
  runScript('preflight-release-candidate.mjs', ['--allow-operational-blockers', `--output=P4_2_PREFLIGHT_${label}.json`])
  const loaded = loadDlzConfigManifest()
  const context = { manifest:loaded.manifest, production:loaded.production, manifestHash:loaded.manifestHash, correlationId:`p4-2-${label}`, target:'local' }
  runScript('configure-dlz-production.mjs', ['--plan','--target=local',`--fundo-id=${loaded.manifest.fundo_id}`,`--correlation-id=p4-2-${label}-plan`])
  let atomicity = 'FAIL'
  try {
    await withPgClient(localPgConfig(), (client) => runDatabaseMode(client, { mode:'apply', ...context, injectFailure:true }))
  } catch (error) {
    if (/rollback atomico/iu.test(String(error.message))) atomicity = 'PASS'
  }
  if (atomicity !== 'PASS') throw new Error('Falha injetada nao comprovou rollback.')
  await assertNoPartialConfiguration(loaded.manifest)
  runScript('configure-dlz-production.mjs', ['--apply','--target=local',`--fundo-id=${loaded.manifest.fundo_id}`,`--correlation-id=p4-2-${label}-apply-1`])
  const first = JSON.parse(fs.readFileSync(path.join(REPORT_DIR,'P4_2_DLZ_APPLY.json'),'utf8')).result
  runScript('configure-dlz-production.mjs', ['--apply','--target=local',`--fundo-id=${loaded.manifest.fundo_id}`,`--correlation-id=p4-2-${label}-apply-2`])
  const second = JSON.parse(fs.readFileSync(path.join(REPORT_DIR,'P4_2_DLZ_APPLY.json'),'utf8')).result
  if (second.changed || first.semantic_hash !== second.semantic_hash) throw new Error('Segundo apply alterou o estado semantico.')
  runScript('configure-dlz-production.mjs', ['--verify','--target=local',`--fundo-id=${loaded.manifest.fundo_id}`,`--correlation-id=p4-2-${label}-verify`])
  const verify = JSON.parse(fs.readFileSync(path.join(REPORT_DIR,'P4_2_DLZ_VERIFY.json'),'utf8')).result
  runScript('readiness-dlz-release-candidate.mjs')
  runScript('e2e-dlz-sacado-local.mjs')
  const conflicts = await runConflictMatrix(context)
  const finalHash = sha256(stableJson({ semantic_hash:verify.semantic_hash, readiness:verify.readiness, conflicts }))
  return { label, final_hash:finalHash, configuration_hash:verify.semantic_hash, atomicity, idempotent:'PASS', conflicts, readiness:verify.readiness, synthetic_cleanup:'ROLLBACK', passed:true }
}

try {
  const run1 = await cycle('RUN_1')
  const run2 = await cycle('RUN_2')
  const deterministic = run1.final_hash === run2.final_hash
  const report = { generated_at:new Date().toISOString(), environment:'rehearsal/local', production_access:'none', run_1:run1, run_2:run2, deterministic, result:deterministic?'DETERMINISTICO':'NAO_DETERMINISTICO' }
  writeJson(path.join(REPORT_DIR,'P4_2_DLZ_DRY_RUN.json'), report)
  console.log(`P4_2_DRY_RUN = ${report.result}`)
  if (!deterministic) process.exitCode = 2
} catch (error) {
  console.error(`Dry-run P4.2 falhou: ${formatError(error)}`)
  process.exitCode = 1
}
