import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, createHmac } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Development-only native contract runner. No remote clients, credentials or
// migration replay. Preserve the existing platform and export schema only.
const fullSuite = process.argv.includes('--full-suite')
assert.deepEqual(process.argv.slice(2), fullSuite ? ['--local-only', '--full-suite'] : ['--local-only'])
assert(!process.env.DOCKER_HOST || /^(npipe:|unix:)/.test(process.env.DOCKER_HOST), 'REMOTE_DOCKER_REFUSED')
const source = 'supabase_db_bw_email03_r1full_cleanroom_179137940498'
const id = `bw-main-native-${Date.now()}`
const names = { runner: `${id}-runner`, db: `${id}-db`, auth: `${id}-auth`, rest: `${id}-rest`, storage: `${id}-storage` }
const label = `bw.qa.native=${id}`
const reports = resolve('rehearsal/reports', id)
await mkdir(reports, { recursive: true })
const report = { id, sourceSchemaOnly: source, scope: 'FIVE_EXISTING_EMAIL03_NATIVE_CONTRACTS',
  fullSuiteRequested: fullSuite, fullMigrationChainCertified: false, remoteChanges: false, phases: [], result: 'IN_PROGRESS', DOCKER_TEST_ENV_CLEANUP: 'PENDING' }
const password = randomBytes(32).toString('hex'), secret = randomBytes(48).toString('hex')
const sensitive = [password, secret]
const hash = value => createHash('sha256').update(value).digest('hex')
const redact = value => sensitive.reduce((text, item) => text.replaceAll(item, '[REDACTED]'), String(value))
  .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[LOCAL_DB_URL]').replace(/eyJ[A-Za-z0-9_.-]{30,}/g, '[JWT]')
async function command(program, args, input, timeout = 120000) {
  return new Promise((done, reject) => {
    const child = spawn(program, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const out = [], err = []; let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeout)
    child.stdout.on('data', bytes => out.push(bytes)); child.stderr.on('data', bytes => err.push(bytes))
    child.stdin.on('error', () => {})
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { clearTimeout(timer); const stdout = Buffer.concat(out).toString('utf8')
      if (code === 0 && !timedOut) done(stdout.trimEnd())
      else reject(new Error(redact(`${program}:${args[0]}:${timedOut ? 'TIMEOUT' : code}:${Buffer.concat(err).toString('utf8').slice(-1800)}:${stdout.slice(-1200)}`)))
    })
    child.stdin.end(input)
  })
}
const docker = (args, input, timeout) => command('docker', args, input, timeout)
const inventory = async () => Object.fromEntries(await Promise.all([
  ['containers', ['ps', '-aq']], ['networks', ['network', 'ls', '-q']], ['volumes', ['volume', 'ls', '-q']],
].map(async ([kind, args]) => [kind, (await docker(args)).split(/\s+/).filter(Boolean).sort()])))
const before = await inventory(), owned = []
report.sourceInputs = await Promise.all(['src/test/email03-local-contracts.mjs',
  'src/lib/documentos/parcelas-nf-boleto-architecture.test.ts', 'src/lib/notas-fiscais/c4-consultor-notas-fiscais.test.ts',
  'scripts/qa/vortx/main-native-qa.mjs', 'scripts/qa/vortx/main-native-fixture.mjs',
].map(async path => ({ path, sha256: hash(await readFile(path)) })))
const phase = async name => { report.phases.push(name); report.currentPhase = name
  await writeFile(resolve(reports, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ stage: name, id })) }
async function start(name, args, image, tail = []) {
  const result = await docker(['run', '-d', '--name', name, '--label', label, ...args, image, ...tail])
  owned.push(['container', name]); return result
}
async function sql(input, database = 'postgres') {
  return docker(['exec', '-i', names.db, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-p', '57862', '-U', 'supabase_admin', '-d', database], input)
}
const envArgs = values => Object.entries(values).flatMap(([key, value]) => ['-e', `${key}=${value}`])
function jwt(role) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000), value = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, iss: 'supabase', iat: now, exp: now + 14400 })}`
  const token = `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`
  sensitive.push(token); return token
}
const anon = jwt('anon'), service = jwt('service_role')
try {
  assert.match(await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']), /^(npipe:|unix:)/)
  await phase('READ_ONLY_SCHEMA_EXPORT')
  const image = await docker(['inspect', source, '--format', '{{.Config.Image}}'])
  assert.match(image, /^public\.ecr\.aws\/supabase\/postgres:/)
  const schema = await docker(['exec', source, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only', '--no-publications', '--no-subscriptions'])
  assert(schema.length > 100000 && !/^COPY |^INSERT INTO /m.test(schema), 'SCHEMA_ONLY_REQUIRED')
  report.schemaSha256 = hash(schema)
  // Actual native platform migration metadata, not application migration history.
  const platformHistory = await docker(['exec', source, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--data-only', '--column-inserts', '-t', 'auth.schema_migrations', '-t', 'storage.migrations'])
  report.platformHistorySha256 = hash(platformHistory)
  // Do not certify the current application against an unverified old runtime.
  // Compare exact SQL bodies (line endings only) to their last main definition.
  const critical = new Set(['handle_new_user', 'registrar_sessao_mfa_atual', 'fiscal_intake_commit',
    'fiscal_intake_stage', 'fiscal_intake_reserve', 'fiscal_validate_stored_actor', 'fiscal_instanciar_requisitos_nota'])
  const expected = new Map()
  for (const path of (await readdir('supabase/migrations')).filter(path => path.endsWith('.sql')).sort()) {
    const text = (await readFile(resolve('supabase/migrations', path), 'utf8')).replaceAll('\r\n', '\n')
    const starts = [...text.matchAll(/CREATE(?: OR REPLACE)? FUNCTION\s+(public|private)\.([a-z_]+)\s*\(/gi)]
    for (let index = 0; index < starts.length; index++) {
      const match = starts[index]; if (!critical.has(match[2])) continue
      const section = text.slice(match.index, starts[index + 1]?.index)
      const delimiter = /\bAS\s+(\$[a-z_0-9]*\$)/i.exec(section)
      if (!delimiter) continue
      const begin = delimiter.index + delimiter[0].length, end = section.indexOf(delimiter[1], begin)
      assert(end >= begin, 'CANONICAL_FUNCTION_BODY_UNTERMINATED')
      expected.set(`${match[1]}.${match[2]}`, { path, body: section.slice(begin, end) })
    }
  }
  const observed = JSON.parse(await docker(['exec', source, 'psql', '-XAt', '-U', 'supabase_admin', '-d', 'postgres', '-c',
    "SELECT json_agg(json_build_object('name',n.nspname||'.'||p.proname,'body',p.prosrc)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private')"]))
  report.canonicalCoreChecks = [...expected].map(([name, value]) => ({ name, source: value.path,
    expected: hash(value.body), actual: hash((observed.find(item => item.name === name)?.body ?? '').replaceAll('\r\n', '\n')) }))
  assert(report.canonicalCoreChecks.length >= critical.size, 'CANONICAL_CORE_PROVENANCE_INCOMPLETE')
  assert(report.canonicalCoreChecks.every(check => check.expected === check.actual), 'LOCAL_SNAPSHOT_CORE_DIFFERS_FROM_MAIN')
  const roles = JSON.parse(await docker(['exec', source, 'psql', '-XAt', '-U', 'supabase_admin', '-d', 'postgres', '-c',
    "SELECT json_agg(json_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createrole',rolcreaterole,'createdb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypass',rolbypassrls)) FROM pg_roles WHERE rolname !~ '^pg_'"]))
  await phase('PREPARE_NODE22_NO_CREDENTIALS')
  await docker(['network', 'create', '--label', label, id]); owned.push(['network', id])
  // Docker Desktop's archive copy does not populate a running tmpfs mount.
  // Use the owned container's disposable writable layer, never a host volume.
  await start(names.runner, ['--network', id, '-w', '/work'], 'node:22-bookworm', ['sleep', 'infinity'])
  await docker(['exec', names.runner, 'mkdir', '/reports'])
  for (const path of ['src', 'scripts', 'supabase', 'docs', '.github', 'public',
    '.gitattributes', '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'DOCUMENTACAO.md', 'README.md', 'components.json',
    'eslint.config.mjs', 'next.config.ts', 'postcss.config.mjs', 'vercel.json',
    'package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts']) {
    await docker(['cp', resolve(path), `${names.runner}:/work/${path}`])
  }
  report.packageTransport = JSON.parse(await docker(['exec', names.runner, 'node', '-e',
    "const fs=require('fs'),crypto=require('crypto');console.log(JSON.stringify({cwd:process.cwd(),files:['package.json','package-lock.json'].map(path=>({path,sha256:crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')}))}))"]))
  for (const file of report.packageTransport.files) assert.equal(file.sha256, hash(await readFile(file.path)), 'NODE_PACKAGE_TRANSPORT_MISMATCH')
  try { await docker(['exec', names.runner, 'npm', 'ci', '--no-audit', '--no-fund'], undefined, 600000) }
  catch (error) {
    const diagnostic = await docker(['exec', names.runner, 'node', '-e',
      "const fs=require('fs');const root='/root/.npm/_logs';for(const file of fs.readdirSync(root)){if(file.endsWith('debug-0.log'))process.stdout.write(fs.readFileSync(root+'/'+file,'utf8'))}"])
    await writeFile(resolve(reports, 'npm-install.log'), redact(diagnostic)); throw error
  }
  // From this point every service shares only this runner's isolated loopback.
  // There are no host publications, Docker socket mounts or external network.
  await docker(['network', 'disconnect', id, names.runner])
  const namespace = ['--network', `container:${names.runner}`]
  await phase('NEW_EMPTY_POSTGRES')
  await start(names.db, [...namespace, '--tmpfs', '/var/lib/postgresql/data',
    '--health-cmd', 'pg_isready -h 127.0.0.1 -p 57862 -U supabase_admin', '--health-interval', '5s',
    ...envArgs({ PGDATA: '/var/lib/postgresql/data', POSTGRES_PASSWORD: password })], image,
    ['postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf', '-c', 'port=57862', '-c', 'listen_addresses=127.0.0.1'])
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const pid = await docker(['exec', names.db, 'cat', '/proc/1/comm'])
      if (['postgres', '.postgres-wrapp'].includes(pid)) { await sql('SELECT 1;'); ready = true; break }
    } catch { /* Fresh image initialization only; bounded readiness, not test retries. */ }
    await new Promise(done => setTimeout(done, 1000))
  }
  assert(ready, 'NATIVE_DB_NOT_READY')
  await sql('CREATE DATABASE native_qa TEMPLATE template0;')
  const existingRoles = new Set((await sql('SELECT rolname FROM pg_roles;')).split('\n'))
  for (const role of roles) if (!existingRoles.has(role.name)) {
    const flags = [['super', 'SUPERUSER'], ['inherit', 'INHERIT'], ['createrole', 'CREATEROLE'], ['createdb', 'CREATEDB'], ['login', 'LOGIN'], ['replication', 'REPLICATION'], ['bypass', 'BYPASSRLS']]
    await sql(`CREATE ROLE "${role.name.replaceAll('"', '""')}" ${flags.map(([key, flag]) => role[key] ? flag : `NO${flag}`).join(' ')};`)
  }
  const snapshot = resolve(reports, 'schema-only.sql')
  await writeFile(snapshot, schema + '\n' + platformHistory)
  await docker(['cp', snapshot, `${names.db}:/tmp/native-schema.sql`])
  assert.equal((await docker(['exec', names.db, 'sha256sum', '/tmp/native-schema.sql'])).split(/\s+/)[0], hash(schema + '\n' + platformHistory))
  await docker(['exec', names.db, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-p', '57862', '-U', 'supabase_admin', '-d', 'native_qa', '-f', '/tmp/native-schema.sql'])
  // Only the new tmpfs database: finish its image-bootstrap background sessions
  // before moving the restored schema to the contract's fixed database name.
  await sql(`ALTER DATABASE postgres ALLOW_CONNECTIONS false;
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND pid<>pg_backend_pid();
    ALTER DATABASE postgres RENAME TO qa_bootstrap;
    ALTER DATABASE qa_bootstrap ALLOW_CONNECTIONS true;
    ALTER DATABASE native_qa RENAME TO postgres;`, 'template1')
  report.nativeSchemaRestored = true
  const securityCatalog = `SELECT md5(jsonb_build_object(
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','private','auth','storage')),
    'tables',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner::regrole::text,c.relrowsecurity,c.relforcerowsecurity,
      (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(coalesce(c.relacl,acldefault('r',c.relowner))) a)) ORDER BY n.nspname,c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','auth','storage') AND c.relkind IN ('r','p'))
    )::text);`
  const sourceSecurity = await docker(['exec', source, 'psql', '-XAt', '-U', 'supabase_admin', '-d', 'postgres', '-c', securityCatalog])
  report.securityCatalog = { source: sourceSecurity, target: await sql(securityCatalog) }
  report.securityCatalog.aclComparison = 'EXACT_EFFECTIVE_ENTRIES_SORTED_NULL_USES_PG_ACLDEFAULT_OWNER_GRANTOR_GRANT_OPTION_PRESERVED'
  if (report.securityCatalog.target !== report.securityCatalog.source) {
    const details = `SELECT jsonb_build_object(
      'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','private','auth','storage')),
      'tables',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner::regrole::text,c.relrowsecurity,c.relforcerowsecurity,c.relacl) ORDER BY n.nspname,c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','auth','storage') AND c.relkind IN ('r','p')));`
    await writeFile(resolve(reports, 'security-source.json'), await docker(['exec', source, 'psql', '-XAt', '-U', 'supabase_admin', '-d', 'postgres', '-c', details]))
    await writeFile(resolve(reports, 'security-target.json'), await sql(details))
  }
  assert.equal(report.securityCatalog.target, report.securityCatalog.source, 'SCHEMA_ACL_OWNER_OR_RLS_DRIFT')
  assert.equal(await sql('SELECT count(*) FROM auth.users; SELECT count(*) FROM public.profiles; SELECT count(*) FROM storage.objects;'), '0\n0\n0', 'USER_DATA_MUST_NOT_BE_COPIED')
  assert.equal(await sql("SELECT count(*) FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created' AND tgenabled='O';"), '1')
  for (const role of ['postgres', 'authenticator', 'supabase_auth_admin', 'supabase_storage_admin']) await sql(`ALTER ROLE ${role} LOGIN PASSWORD '${password}';`)
  await phase('OFFICIAL_AUTH_POSTGREST_STORAGE')
  await start(names.auth, [...namespace, ...envArgs({
    GOTRUE_API_HOST: '127.0.0.1', GOTRUE_API_PORT: '9999', GOTRUE_DB_DRIVER: 'postgres',
    GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${password}@127.0.0.1:57862/postgres`,
    GOTRUE_SITE_URL: 'http://127.0.0.1:57861', API_EXTERNAL_URL: 'http://127.0.0.1:57861',
    GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_EXP: '3600',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'true',
    GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true', GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true',
  })], 'public.ecr.aws/supabase/gotrue:v2.194.0')
  await start(names.rest, [...namespace, ...envArgs({
    PGRST_DB_URI: `postgres://authenticator:${password}@127.0.0.1:57862/postgres`, PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret,
    PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: '3000',
  })], 'public.ecr.aws/supabase/postgrest:v14.15')
  await start(names.storage, [...namespace, '--tmpfs', '/storage', ...envArgs({
    ANON_KEY: anon, SERVICE_KEY: service, AUTH_JWT_SECRET: secret,
    DATABASE_URL: `postgres://supabase_storage_admin:${password}@127.0.0.1:57862/postgres`,
    POSTGREST_URL: 'http://127.0.0.1:3000', STORAGE_BACKEND: 'file', FILE_STORAGE_BACKEND_PATH: '/storage',
    TENANT_ID: 'qa-local-only', REGION: 'local', GLOBAL_S3_BUCKET: 'qa-local-only', FILE_SIZE_LIMIT: '20971520',
    ENABLE_IMAGE_TRANSFORMATION: 'false', HOST: '127.0.0.1', PORT: '5000',
  })], 'public.ecr.aws/supabase/storage-api:v1.67.20')
  const gateway = `const http=require('node:http');const targets=[['/auth/v1',9999],['/rest/v1',3000],['/storage/v1',5000]];
    http.createServer((req,res)=>{const route=targets.find(([prefix])=>req.url===prefix||req.url.startsWith(prefix+'/'));
    if(!route){res.writeHead(404);res.end();return}const upstream=http.request({host:'127.0.0.1',port:route[1],path:req.url.slice(route[0].length)||'/',method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)});
    upstream.on('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream)}).listen(57861,'127.0.0.1');`
  await docker(['exec', '-d', names.runner, 'node', '-e', gateway])
  await docker(['exec', names.runner, 'node', '-e', `
    (async()=>{for(let i=0;i<80;i++){try{const results=await Promise.all(['http://127.0.0.1:9999/health','http://127.0.0.1:5000/status','http://127.0.0.1:3000/'].map(url=>fetch(url)));if(results.every(r=>r.ok))return}catch{}await new Promise(r=>setTimeout(r,500))}process.exit(1)})()`])
  report.loopbackOnlyNoHostPorts = true
  await phase('CANONICAL_SYNTHETIC_FIXTURE')
  const seed = `import {Client} from 'pg';import {seedNativeFixture} from './scripts/qa/vortx/main-native-fixture.mjs';
    const db=new Client({host:'127.0.0.1',port:57862,user:'postgres',password:process.env.LOCAL_QA_PG_PASSWORD,database:'postgres'});
    await db.connect();try{console.log(JSON.stringify(await seedNativeFixture(db)))}finally{await db.end()}`
  report.fixture = JSON.parse(await docker(['exec', '-e', `LOCAL_QA_PG_PASSWORD=${password}`, names.runner, 'node', '--input-type=module', '-e', seed]))
  await phase('UNCHANGED_NATIVE_TESTS')
  const testEnvironment = { EMAIL_INTAKE_DISPOSABLE_SMOKE: 'true', EMAIL03_LOCAL_CONTRACT_REPORT: '/reports/contracts', LOCAL_QA_PG_PASSWORD: password,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:57861', NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service }
  try {
    await docker(['exec', ...envArgs(testEnvironment), names.runner, 'node', 'node_modules/vitest/vitest.mjs', 'run',
      'src/lib/documentos/parcelas-nf-boleto-architecture.test.ts', 'src/lib/notas-fiscais/c4-consultor-notas-fiscais.test.ts',
      '--pool=threads', '--maxWorkers=1', '--no-file-parallelism', '--reporter=json', '--outputFile=/reports/vitest.json'], undefined, 600000)
  } finally { await docker(['cp', `${names.runner}:/reports/.`, reports]) }
  const vitest = JSON.parse(await readFile(resolve(reports, 'vitest.json'), 'utf8'))
  assert.equal(vitest.numFailedTests, 0, 'NATIVE_VITEST_FAILURES')
  assert(vitest.numPassedTests >= 5, 'NATIVE_VITEST_ASSERTIONS_MISSING')
  report.nativeContracts = await Promise.all((await readdir(resolve(reports, 'contracts'))).filter(path => path.endsWith('.json'))
    .map(async path => JSON.parse(await readFile(resolve(reports, 'contracts', path), 'utf8'))))
  assert.deepEqual(report.nativeContracts.map(item => item.mode).sort(), ['ATOMIC_ROLLBACK', 'INVALID_SUM', 'ISSUER_SCOPE', 'NO_DUP', 'ORDER_FANOUT'])
  assert(report.nativeContracts.every(item => item.status === 'PASS' && item.nativeAuth === true
    && item.checks.includes('NATIVE_PASSWORD_TOTP_CANONICAL_SESSION')), 'NATIVE_CONTRACT_PROOF_INCOMPLETE')
  report.vitest = { passed: vitest.numPassedTests, failed: vitest.numFailedTests, skipped: vitest.numPendingTests }
  if (fullSuite) {
    await phase('FULL_VITEST_WITH_NATIVE_QA_NODE22_LINUX')
    try {
      await docker(['exec', ...envArgs(testEnvironment), names.runner, 'node', 'node_modules/vitest/vitest.mjs', 'run',
        '--pool=threads', '--maxWorkers=1', '--no-file-parallelism', '--reporter=json', '--outputFile=/reports/full-vitest.json'], undefined, 600000)
    } finally { await docker(['cp', `${names.runner}:/reports/.`, reports]) }
    const complete = JSON.parse(await readFile(resolve(reports, 'full-vitest.json'), 'utf8'))
    assert.equal(complete.numFailedTests, 0, 'FULL_NATIVE_VITEST_FAILURES')
    assert(complete.numTotalTests >= 4007, 'FULL_SUITE_INCOMPLETE')
    report.fullVitest = { total: complete.numTotalTests, passed: complete.numPassedTests, failed: complete.numFailedTests, skipped: complete.numPendingTests }
  }
  report.result = 'PASS'
} catch (error) {
  report.result = 'BLOCKED_OR_FAILED'; report.error = redact(error.message); process.exitCode = 1
  console.log(JSON.stringify({ stage: report.currentPhase, result: report.result, error: report.error }))
} finally {
  report.cleanup = []
  for (const [kind, name] of owned.reverse()) {
    try {
      const actual = await docker(kind === 'container' ? ['inspect', '--format', '{{index .Config.Labels "bw.qa.native"}}', name] : ['network', 'inspect', '--format', '{{index .Labels "bw.qa.native"}}', name])
      assert.equal(actual, id, 'OWNERSHIP_MISMATCH')
      await docker(kind === 'container' ? ['rm', '-f', '-v', name] : ['network', 'rm', name])
      report.cleanup.push({ name, result: 'REMOVED_OWN_ONLY' })
    } catch (error) { report.cleanup.push({ name, result: 'FAIL', error: redact(error.message) }); process.exitCode = 1 }
  }
  const after = await inventory()
  report.preexistingResourcesPreserved = Object.keys(before).every(kind => before[kind].every(resource => after[kind].includes(resource)))
  const remaining = await docker(['ps', '-aq', '--filter', `label=${label}`])
  report.DOCKER_TEST_ENV_CLEANUP = !remaining && report.preexistingResourcesPreserved && report.cleanup.every(item => item.result === 'REMOVED_OWN_ONLY') ? 'PASS' : 'FAIL'
  report.resourceInventories = { before, after }
  if (report.DOCKER_TEST_ENV_CLEANUP !== 'PASS') process.exitCode = 1
  await writeFile(resolve(reports, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ result: report.result, cleanup: report.DOCKER_TEST_ENV_CLEANUP, reports }))
}
