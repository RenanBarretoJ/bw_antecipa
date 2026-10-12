import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { configureDisposableToml, sanitizedLocalEnvironment, redactCommandOutput, fileSha256 } from '../perf9e/clean-room-lib.mjs'
import { verifyFiscalFencing } from './fencing-db.mjs'
import { verifyStorageApi } from './storage-api.mjs'
import { verifyEmailAutomation } from './automation-db.mjs'
import { verifyEmailTemporalAdmission } from './temporal-db.mjs'
import { verifyEmailOperators } from './operators-db.mjs'
import { verifyScopedClaims } from './scoped-claims-db.mjs'
import { prepareEmailBrowserRuntime } from './browser-runtime.mjs'
import { disposableResources, nativeSupabaseCli } from './disposable-resources.mjs'

// Reuse platform bootstrap from the supported CLI. No schema stubs or remote links.
assert.deepEqual(process.argv.slice(2), ['--local-only'])
const projectId = `bw_email03_scoped_${Date.now()}`
const root = resolve('rehearsal/tmp', projectId)
const cli = await nativeSupabaseCli()
const environment = sanitizedLocalEnvironment()
const storageApi = true
const automation = false
const operatorsOnly = process.argv.includes('--operators-only')
const operators = true
for (const key of Object.keys(environment)) if (/EMAIL_INTAKE|SECRET|PASSWORD|TOKEN|CREDENTIAL/i.test(key)) delete environment[key]
// Explicit executable path makes the same official browser smoke portable to Linux CI.
if (process.env.EMAIL_INTAKE_QA_CHROME) environment.EMAIL_INTAKE_QA_CHROME = process.env.EMAIL_INTAKE_QA_CHROME
const source = resolve('supabase/migrations')
const plan = JSON.parse(await readFile('rehearsal/reports/EMAIL03_LOCAL_SQL_PLAN.json', 'utf8'))
assert.equal(plan.productionBaseline, '2e8146ebe7582c5bdc10ddee1f8862d806607ee2')
const files = plan.emailSql.map(e => e.path.split('/').at(-1))
const evidence = { projectId, startedAt: new Date().toISOString(), productionChanged: false,
  source: files.map(name => ({ name, sha256: fileSha256(resolve(source, name)) })),
  migrationsApplied: 0, fencingChecks: [], storageApiChecks: [], sharedServiceChecks: [], result: 'NOT_RUN', failure: null, cleanup: 'NOT_RUN' }
await mkdir(resolve(root, 'supabase/migrations'), { recursive: true })
await mkdir('rehearsal/reports', { recursive: true })
// Start an empty owned platform. Historical baseline is LOCAL reconstruction, never release SQL.
for (const entry of plan.emailSql) assert.equal(fileSha256(entry.path), entry.sha256)
const config = configureDisposableToml(await readFile('supabase/config.toml', 'utf8'), {
  projectId, apiPort: 57861, dbPort: 57862, shadowPort: 57860, studioPort: 57863, mailPort: 57864, analyticsPort: 57867,
})
await writeFile(resolve(root, 'supabase/config.toml'), config, 'utf8')
assert.equal(/project_id = "([^\"]+)"/.exec(config)?.[1], projectId)
assert.ok(root.startsWith(resolve('rehearsal/tmp') + '\\') || root.startsWith(resolve('rehearsal/tmp') + '/'))

let activeCli
function run(args) {
  return new Promise((done, reject) => {
    const child = spawn(cli, [...args, '--workdir', root], { env: environment, windowsHide: true })
    activeCli = child
    let output = ''
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output += bytes.toString() })
    child.on('error', reject)
    child.on('exit', code => { activeCli = null; done({ code, output }) })
  })
}
const owned = await disposableResources({ projectId, file: `rehearsal/reports/${projectId}-resources.json`, tempDirs: [root] })
let cleanupPromise
const cleanup = () => cleanupPromise ??= (async () => {
  const stop = async () => {
    const result = await run(['stop', '--project-id', projectId, '--no-backup'])
    assert.equal(result.code, 0, 'NATIVE_CLI_STOP_FAILED')
  }
  await owned.cleanup(stop)
  await owned.cleanup(stop)
})()
const interrupted = async () => {
  const child = activeCli
  if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited }
  try { await cleanup() } finally { process.exit(130) }
}
process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted)
async function checkpoint(phase) {
  await writeFile(resolve(root, 'clean-room-checkpoint.json'), JSON.stringify({ ...evidence, phase, result: 'IN_PROGRESS' }, null, 2))
}
try {
  console.log(JSON.stringify({ stage: 'START_ISOLATED_LOCAL', projectId, migrationCount: files.length }))
  // The operator portal includes the notification bell; its real WebSocket needs Realtime.
  const excluded = storageApi ? `${operators ? '' : 'realtime,'}imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`
    : 'gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'
  const start = await run(['start', '--exclude', excluded])
  await owned.capture()
  if (start.code !== 0) {
    evidence.result = 'FAIL'
    evidence.failure = redactCommandOutput(start.output).slice(-4000)
  } else {
    const connection = { host: '127.0.0.1', port: 57862, user: 'postgres', password: 'postgres', database: 'postgres' }
    const client = new Client(connection)
    await client.connect()
    try {
      evidence.baselineExcluded = plan.excludedOrMissing
      evidence.baselineKind = 'LOCAL_RECONSTRUCTED_NOT_LIVE_SCHEMA_CERTIFICATION'
      for (const kind of ['TABLES','SEQUENCES','FUNCTIONS']) await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM anon,authenticated,service_role`)
      await client.query("CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;SET search_path=public,extensions;SET statement_timeout='120s';SET lock_timeout='5s'")
      evidence.baselineApplied=[]
      for(const entry of plan.baseline){
        evidence.stage='BASELINE:'+entry.version
        await client.query(entry.sql)
        evidence.baselineApplied.push({version:entry.version,sha256:entry.sha256})
      }
      evidence.sqlApplied=[]
      for(const entry of plan.emailSql){
        evidence.stage='EMAIL_SQL:'+entry.version
        await client.query(await readFile(entry.path,'utf8'))
        evidence.sqlApplied.push(entry)
      }
      evidence.migrationsApplied=evidence.sqlApplied.length
      await client.query("NOTIFY pgrst,'reload schema'")
      const fixture = await readFile('supabase/tests/c2_1_r2_fluxo_taxa.test.sql', 'utf8')
      const setup = fixture.match(/DO \$setup\$[\s\S]*?\$setup\$;/)?.[0]
      assert.ok(setup, 'Official review fixture not found')
      const beforeNf = setup.indexOf('  INSERT INTO public.notas_fiscais (')
      assert.ok(beforeNf > 0, 'Official fixture NF boundary not found')
      await client.query('BEGIN')
      try {
        await client.query(`${setup.slice(0, beforeNf)}END;\n$setup$;`)
        await client.query(await readFile('supabase/tests/guibor_nfse_review_intents.assert.sql', 'utf8'))
      } finally { await client.query('ROLLBACK') }
      let local, storageFixtures
      if (storageApi) {
        const status = await run(['status', '--output', 'json'])
        assert.equal(status.code, 0, 'Disposable API status unavailable')
        // CLI diagnostics use stderr. Parse only the JSON object and keep keys in memory.
        const begin = status.output.indexOf('{'), end = status.output.lastIndexOf('}')
        local = JSON.parse(status.output.slice(begin, end + 1))
        assert.equal(new URL(local.API_URL).origin, 'http://127.0.0.1:57861')
        const api = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
        storageFixtures = {
          async put(intent) {
            const result = await api.storage.from(intent.bucket).upload(intent.path, Buffer.alloc(100, 32), { contentType: 'application/xml', upsert: false })
            assert.ok(!result.error, `QA_API_UPLOAD: ${result.error?.statusCode ?? 'unknown'}`)
          },
          async remove(intent) {
            const result = await api.storage.from(intent.bucket).remove([intent.path])
            assert.ok(!result.error, `QA_API_DELETE: ${result.error?.statusCode ?? 'unknown'}`)
          },
        }
      }
      if (operatorsOnly) await client.query(`${setup.slice(0, beforeNf)}END;\n$setup$;`)
      else evidence.fencingChecks = await verifyFiscalFencing(client, connection, `${setup.slice(0, beforeNf)}END;\n$setup$;`, storageFixtures)
      if (automation) evidence.automationChecks = await verifyEmailAutomation(client, connection)
      if (automation) evidence.temporalChecks = await verifyEmailTemporalAdmission(client, connection)
      if (operators) evidence.operatorChecks = await verifyEmailOperators(client, connection)
      evidence.scopedProductionClaimChecks = await verifyScopedClaims(client)
      if (storageApi) {
        const physicalObjects = reservationId => new Promise((done, reject) => {
          assert.match(reservationId, /^[0-9a-f-]{36}$/)
          const child = spawn('docker', ['exec', '-i', `supabase_storage_${projectId}`, 'node', '-', reservationId], { windowsHide: true })
          let output = ''
          child.stdout.on('data', bytes => { output += bytes.toString() })
          child.on('error', reject)
          child.on('exit', code => code === 0 && /^\d+$/.test(output.trim()) ? done(Number(output.trim())) : reject(new Error(`PHYSICAL_STORAGE_INSPECTION_FAILED:${code}`)))
          child.stdin.end(`const fs=require('node:fs'),path=require('node:path');
            const root=process.env.FILE_STORAGE_BACKEND_PATH;
            if(!root||!fs.existsSync(root))process.exit(2);
            let count=0;
            function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
              const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);
              else if(entry.isFile()&&file.includes(process.argv[2]))count++;
            }}walk(root);process.stdout.write(String(count));`)
        })
        evidence.storageApiChecks = await verifyStorageApi({ db: client, url: local.API_URL, serviceKey: local.SERVICE_ROLE_KEY, physicalObjects })
        await checkpoint('SQL_STORAGE_COMPLETE')
        const sharedReport = resolve(root, 'shared-result.json')
        const browserEnvironment = { ...environment, NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
          PORTAL_FIDC_CREDENTIAL_KEYS_JSON: JSON.stringify({ qa: 'a'.repeat(64) }), PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION: 'qa',
          NFSE_UPLOAD_ENABLED: 'true', OPENAI_API_KEY: '', EMAIL_INTAKE_DISPOSABLE_SMOKE: 'true', EMAIL_INTAKE_SMOKE_REPORT: sharedReport }
        await prepareEmailBrowserRuntime(browserEnvironment, root)
        const shared = await new Promise((done, reject) => {
          const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'scripts/email-intake/vitest.shared.config.mjs', '--pool=threads', '--maxWorkers=1', '--no-file-parallelism'], {
            windowsHide: true, env: browserEnvironment,
          })
          let output = ''
          for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output += bytes.toString() })
          child.on('error', reject)
          child.on('exit', code => done({ code, output }))
        })
        await writeFile(`rehearsal/reports/RLX_EMAIL_03_SHARED_${projectId}.log`, redactCommandOutput(shared.output))
        const sharedResult = JSON.parse(await readFile(sharedReport, 'utf8').catch(() => '{"result":"FAIL","stage":"CHILD_STARTUP"}'))
        evidence.sharedServiceChecks = sharedResult.checks ?? []
        assert.equal(shared.code, 0, `SHARED_SERVICE_SMOKE:${sharedResult.stage ?? sharedResult.result}:${sharedResult.message ?? ''}`)
        assert.equal(sharedResult.result, 'PASS', 'Shared service report is required for certification')
        assert.ok(evidence.sharedServiceChecks.includes('OFFICIAL_FORM_SYSTEM_TO_HUMAN_PERSISTENCE'), 'Official browser review proof missing')
        await checkpoint('OFFICIAL_REVIEW_COMPLETE')
        // Full historical operator recertification is outside this finite smoke.
      }
      evidence.result = 'PASS'
    } finally { await client.end() }
  }
} catch (error) {
  evidence.result = 'FAIL'
  evidence.failure = redactCommandOutput(error instanceof Error ? error.message : 'LOCAL_CLEAN_ROOM_FAILED')
} finally {
  try { await cleanup(); evidence.cleanup = 'PASS'; evidence.cleanupIdempotent = 'PASS' }
  catch { evidence.cleanup = 'FAIL' }
  process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted)
  await writeFile(`rehearsal/reports/RLX_EMAIL_03_CLEAN_ROOM_${projectId}.json`, JSON.stringify(evidence, null, 2) + '\n', 'utf8')
  await writeFile('rehearsal/reports/EMAIL03_LOCAL_FUNCTIONAL_SMOKE.json', JSON.stringify(evidence, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({ result: evidence.result, cleanup: evidence.cleanup, migrationsApplied: evidence.migrationsApplied,
    failure: evidence.failure, evidence: 'rehearsal/reports/EMAIL03_LOCAL_FUNCTIONAL_SMOKE.json' }))
  if (evidence.result !== 'PASS' || evidence.cleanup !== 'PASS') process.exitCode = 1
}
