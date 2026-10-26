import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const postSnapshotMigrations = [
  'supabase/migrations/20261022121028_vortx_carteira_atomic_persistence.sql',
  'supabase/migrations/20261022174904_financial_reconciliation_conditional_movements.sql',
  'supabase/migrations/20261022211047_vrs_duplicata_parcela_keys.sql',
  'supabase/migrations/20261023143138_consultor_operacao_memoria_readonly.sql',
  'supabase/migrations/20261026163837_s1_serpro_nfe_gestor.sql',
]

const sha256 = value => createHash('sha256').update(value).digest('hex')

export async function applyS1BrowserUpgrade(sql, phase) {
  const applied = []
  for (const path of postSnapshotMigrations) {
    const body = await readFile(path, 'utf8')
    await phase(`S1_BROWSER_UPGRADE_${path.split('/').at(-1).slice(0, 14)}`)
    await sql(body)
    applied.push({ path, sha256: sha256(body.replaceAll('\r\n', '\n')), result: 'APPLIED_EXACT_BYTES_LOCAL_ONLY' })
  }
  assert.equal(await sql(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname LIKE 'nfe_fiscal_%' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;`), '0')
  assert.equal(await sql(`SELECT capability_state||':'||circuit_state||':'||daily_budget::text FROM public.nfe_fiscal_provider_state WHERE provider='SERPRO';`), 'UNVERIFIED:OPEN:0')
  return { result: 'PASS', migrations: applied, migrationHistoryWritten: false, providerState: 'UNVERIFIED_OPEN_BUDGET_ZERO' }
}

export async function runS1BrowserQa({ docker, names, password, anon, service, sql, phase, reports, envArgs }) {
  await phase('S1_PGTAP_RLS_FULL_STACK')
  const tap = await sql(await readFile('supabase/tests/s1_serpro_nfe_gestor.test.sql', 'utf8'))
  assert.match(tap, /1\.\.22/)
  assert.doesNotMatch(tap, /not ok/i)

  await phase('S1_PROVIDER_MOCK_NO_EGRESS')
  await docker(['exec', ...envArgs({
    SERPRO_NFE_WORKER_ENABLED: 'false', SERPRO_NFE_CONTRACT_VERIFIED: 'false', SERPRO_NFE_QUERY_ENABLED: 'false',
  }), names.runner, 'node', 'node_modules/vitest/vitest.mjs', 'run', 'src/lib/serpro-nfe',
    '--pool=threads', '--maxWorkers=1', '--no-file-parallelism', '--reporter=json', '--outputFile=/reports/s1-provider.json'])

  await phase('S1_AUTH_TOTP_SYNTHETIC_FIXTURE')
  const runtimeReport = '/reports/s1-browser-runtime.json'
  const runtimeEnv = {
    LOCAL_QA_PG_PASSWORD: password,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:57861',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
    S1_BROWSER_REPORT: runtimeReport,
    S1_BROWSER_EXECUTABLE: '/usr/bin/chromium',
  }
  await docker(['exec', ...envArgs(runtimeEnv), names.runner, 'node', 'scripts/qa/serpro/s1-browser-runtime.mjs', '--seed'])

  await phase('S1_NEXT_LOCAL_NO_EGRESS')
  const appEnv = {
    ...runtimeEnv,
    APP_BASE_URL: 'http://127.0.0.1:57860',
    NEXT_PUBLIC_APP_ENV: 'local',
    INTEGRATION_RUNTIME_ENV: 'local',
    AUTH_FLOW_COOKIE_SECRET: 'local-only-s1-cookie-secret-with-more-than-32-bytes',
    NEXT_TELEMETRY_DISABLED: '1',
    NFSE_UPLOAD_ENABLED: 'false',
    SERPRO_NFE_WORKER_ENABLED: 'false',
    SERPRO_NFE_CONTRACT_VERIFIED: 'false',
    SERPRO_NFE_QUERY_ENABLED: 'false',
    SERPRO_NFE_CONSUMER_KEY: '',
    SERPRO_NFE_CONSUMER_SECRET: '',
    SERPRO_NFE_TOKEN_URL: '',
    SERPRO_NFE_BASE_URL: '',
  }
  await docker(['exec', '-d', ...envArgs(appEnv), names.runner, 'npm', 'run', 'dev', '--', '-H', '127.0.0.1', '-p', '57860'])
  await docker(['exec', names.runner, 'node', '-e', `(async()=>{for(let i=0;i<120;i++){try{const r=await fetch('http://127.0.0.1:57860/login');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,500))}process.exit(1)})()`], undefined, 90000)

  await phase('S1_REAL_BROWSER_AUTH_MFA_RLS_DOM')
  await docker(['exec', ...envArgs(appEnv), names.runner, 'node', 'scripts/qa/serpro/s1-browser-runtime.mjs', '--browser'], undefined, 180000)
  await docker(['cp', `${names.runner}:/reports/.`, reports])
  const browser = JSON.parse(await readFile(resolve(reports, 's1-browser-runtime.json'), 'utf8'))
  assert.equal(browser.result, 'PASS')
  assert.equal(browser.realBrowser, true)
  assert.equal(browser.realPasswordAndTotp, true)
  assert.equal(browser.externalRequests, 0)
  const provider = JSON.parse(await readFile(resolve(reports, 's1-provider.json'), 'utf8'))
  assert.equal(provider.numFailedTests, 0)
  await mkdir(resolve(reports, 's1'), { recursive: true })
  await writeFile(resolve(reports, 's1', 'summary.json'), JSON.stringify({ tap, provider: { passed: provider.numPassedTests }, browser }, null, 2))
  return { result: 'PASS', pgtap: 22, providerMockTests: provider.numPassedTests, ...browser }
}
