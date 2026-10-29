import assert from 'node:assert/strict'
import { observeTransport } from './s2-2sr-transport.mjs'
import { randomBytes, createHash, createHmac } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { decodeSnapshot, securityCatalog } from '../vortx/main-native-snapshot.mjs'
import { applyS1BrowserUpgrade } from './s1-browser-local.mjs'
import { rehearseReleaseUpgrade } from '../vortx/main-release-upgrade.mjs'
import { prepareLinuxDependencyVolume, runLinuxProductionBuild } from './s2-2sr-linux-dependencies.mjs'

// Only this provisioner creates resources. All services are created and inspected
// BEFORE starting, on one internal network, without host port publications.
const id = `bw-s22r-${Date.now()}-${process.pid}`
const names = { db: `${id}-db`, runner: `${id}-runner` }
const nativeFull = process.argv.includes('--native-full')
if (nativeFull) Object.assign(names, { auth: `${id}-auth`, rest: `${id}-rest`, storage: `${id}-storage` })
const label = `bw.qa.s22r=${id}`
const root = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence', 's2-2r-local-20261028', id)
const password = randomBytes(32).toString('hex')
const secret = randomBytes(48).toString('hex')
const jwt = role => {
  const input = [JSON.stringify({ alg: 'HS256', typ: 'JWT' }), JSON.stringify({ role, iss: 'supabase', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+7200 })]
    .map(value => Buffer.from(value).toString('base64url')).join('.')
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`
}
const anon = jwt('anon'), service = jwt('service_role')
const envArgs = values => Object.entries(values).flatMap(([key, value]) => ['-e', `${key}=${value}`])
const owned = []
const report = { id, status: 'IN_PROGRESS', node: process.version, stages: [], transportEvents: [], providerCalls: 0,
  remoteChanges: false, pilotMigrationsApplied: false, DOCKER_TEST_ENV_CLEANUP: 'PENDING' }
await mkdir(root, { recursive: true })
const sanitize = text => String(text).replaceAll(password, '[SYNTHETIC_SECRET]')
  .replaceAll(secret, '[SYNTHETIC_SECRET]').replaceAll(anon, '[SYNTHETIC_JWT]').replaceAll(service, '[SYNTHETIC_JWT]')
  .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[DB_URL]')
async function command(program, args, input, timeout = 120000) {
  let result
  try {
    result = await observeTransport(program, args, input, timeout, { sanitize, phase: report.stages.at(-1) ?? 'PREFLIGHT' })
  } catch (error) {
    if (error.transport) report.transportEvents.push(error.transport)
    throw error
  }
  report.transportEvents.push(result.transport)
  const stdout = result.stdout.trimEnd()
  if (result.status === 0) return stdout
  const error = new Error(sanitize(`${program} ${args[0]} exit=${result.status}: ${result.stderr.slice(-1500)} ${stdout.slice(-4500)}`)
    + ` ${JSON.stringify(result.transport)}`)
  error.transport = result.transport
  throw error
}
const docker = (args, input, timeout) => command('docker', args, input, timeout)
const inventory = async () => Object.fromEntries(await Promise.all([
  ['containers', ['ps', '-aq', '--no-trunc']], ['networks', ['network', 'ls', '-q', '--no-trunc']],
  ['volumes', ['volume', 'ls', '-q']],
].map(async ([kind, args]) => [kind, (await docker(args)).split(/\s+/).filter(Boolean).sort()])))
const before = await inventory()
report.before = before
const phase = async name => {
  report.stages.push(name)
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(name)
}
const sql = (input, database = 'postgres') => docker([
  'exec', '-i', names.db, 'psql', '-qXAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', database,
], input)
async function candidateManifest() {
  const changed=await command('git',['diff','--name-only'])
  const untracked=await command('git',['ls-files','--others','--exclude-standard'])
  return Promise.all([...new Set((changed+'\n'+untracked).split(/\r?\n/).filter(Boolean))].sort().map(async path=>({
    path,canonicalLfSha256:createHash('sha256').update((await readFile(path,'utf8')).replace(/\r\n/g,'\n')).digest('hex'),
  })))
}
async function inspectContained() {
  const network = JSON.parse(await docker(['network', 'inspect', id]))[0]
  assert.equal(network.Internal, true, 'INTERNAL_NETWORK_REQUIRED')
  return Promise.all(Object.values(names).map(async name => {
    const c = JSON.parse(await docker(['inspect', name]))[0]
    assert.equal(c.Config.Labels['bw.qa.s22r'], id)
    assert.deepEqual(Object.keys(c.HostConfig.PortBindings ?? {}), [], 'NO_HOST_PORT_BINDINGS')
    assert.ok(Object.values(c.NetworkSettings.Ports ?? {}).every(value => value === null), 'NO_IPV4_OR_IPV6_HOST_BINDINGS')
    assert.deepEqual(Object.keys(c.NetworkSettings.Networks), [id], 'ONE_DEDICATED_NETWORK_ONLY')
    assert.equal(c.HostConfig.PublishAllPorts, false)
    assert.notEqual(c.HostConfig.NetworkMode, 'host')
    if (nativeFull && name === names.runner) {
      assert.equal(c.Mounts.filter(m => m.Type === 'volume' && m.Name === report.dependencies.volume
        && m.Destination === '/linux-deps' && m.RW === false).length, 1, 'READ_ONLY_LINUX_DEPENDENCY_VOLUME_REQUIRED')
    }
    return { name, image: c.Image, running: c.State.Running, hostBindings: c.HostConfig.PortBindings,
      ports: c.NetworkSettings.Ports, networks: Object.keys(c.NetworkSettings.Networks), internal: network.Internal }
  }))
}
try {
  assert.ok(process.version.startsWith('v22.'), 'NODE22_REQUIRED')
  report.candidateSources = await candidateManifest()
  assert(!process.env.DOCKER_HOST || /^(npipe:|unix:)/.test(process.env.DOCKER_HOST), 'LOCAL_DOCKER_ONLY')
  assert.match(await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']), /^(npipe:|unix:)/)
  // This pinned, versioned fixture contains schema and native migration metadata
  // only. No runtime source DB, rows, secrets, volumes or networks are copied.
  const manifest = JSON.parse(await readFile('scripts/qa/vortx/main-integration-manifest.json', 'utf8'))
  const snapshot = decodeSnapshot(await readFile(manifest.nativeSnapshot.path, 'utf8'), manifest.nativeSnapshot.sha256)
  report.schemaSha256 = snapshot.schemaSha256
  const dbImage = JSON.parse(await docker(['image', 'inspect', snapshot.image]))[0].Id
  // The complete official image supplies OpenSSL for existing loopback mTLS
  // integration tests. Resolve a local immutable ID; never install on this net.
  const runnerImage = JSON.parse(await docker(['image', 'inspect', 'node:22-bookworm']))[0].Id
  if (nativeFull) report.dependencies = await prepareLinuxDependencyVolume({ docker, id, image: runnerImage, owned, phase, root })
  report.plan = { images: { db: dbImage, runner: runnerImage }, names, network: { name: id, internal: true },
    ports: [], publishAllPorts: false, source: 'VERSIONED_SCHEMA_ONLY', mounts: 'repository read-only; own DB tmpfs' }
  await phase('RESOLVED_NO_PORTS_PLAN_VERIFIED')
  await docker(['network', 'create', '--internal', '--label', label, id]); owned.push(['network', id])
  await docker(['create', '--name', names.db, '--label', label, '--network', id, '--network-alias', 's22-db',
    '--tmpfs', '/var/lib/postgresql/data', '-e', 'PGDATA=/var/lib/postgresql/data', '-e', `POSTGRES_PASSWORD=${password}`,
    dbImage, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf', '-c', 'listen_addresses=*'])
  owned.push(['container', names.db])
  await docker(['create', '--name', names.runner, '--label', label, '--network', id,
    '--mount', `type=bind,source=${process.cwd()},target=/work,readonly`,
    ...(nativeFull ? ['--mount', `type=volume,source=${report.dependencies.volume},target=/linux-deps,readonly`] : []),
    '-w', '/work', runnerImage, 'sleep', 'infinity'])
  owned.push(['container', names.runner])
  if (nativeFull) {
    const services = [
      ['auth', 'public.ecr.aws/supabase/gotrue:v2.194.0', {
        GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', GOTRUE_DB_DRIVER: 'postgres',
        GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${password}@s22-db:5432/postgres`,
        GOTRUE_SITE_URL: 'http://127.0.0.1:57861', API_EXTERNAL_URL: 'http://127.0.0.1:57861',
        GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_EXP: '3600',
        GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'true',
        GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true', GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true',
      }],
      ['rest', 'public.ecr.aws/supabase/postgrest:v14.15', {
        PGRST_DB_URI: `postgres://authenticator:${password}@s22-db:5432/postgres`, PGRST_DB_SCHEMAS: 'public',
        PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret,
        PGRST_SERVER_HOST: '0.0.0.0', PGRST_SERVER_PORT: '3000',
      }],
      ['storage', 'public.ecr.aws/supabase/storage-api:v1.67.20', {
        ANON_KEY: anon, SERVICE_KEY: service, AUTH_JWT_SECRET: secret,
        DATABASE_URL: `postgres://supabase_storage_admin:${password}@s22-db:5432/postgres`, POSTGREST_URL: 'http://s22-rest:3000',
        STORAGE_BACKEND: 'file', FILE_STORAGE_BACKEND_PATH: '/storage', TENANT_ID: 'qa-local-only', REGION: 'local',
        GLOBAL_S3_BUCKET: 'qa-local-only', FILE_SIZE_LIMIT: '20971520', ENABLE_IMAGE_TRANSFORMATION: 'false', HOST: '0.0.0.0', PORT: '5000',
      }],
    ]
    for (const [kind, tag, environment] of services) {
      const image = JSON.parse(await docker(['image', 'inspect', tag]))[0].Id
      report.plan.images[kind] = image
      await docker(['create', '--name', names[kind], '--label', label, '--network', id, '--network-alias', `s22-${kind}`,
        ...(kind === 'storage' ? ['--tmpfs', '/storage'] : []), ...envArgs(environment), image])
      owned.push(['container', names[kind]])
    }
  }
  report.beforeStartInspection = await inspectContained()
  assert.ok(report.beforeStartInspection.every(c => !c.running), 'INSPECT_BEFORE_START_REQUIRED')
  await phase('PRESTART_INSPECT_PASS_NO_PORTS_INTERNAL_ONLY')
  await docker(['start', names.db, names.runner])
  report.afterStartInspection = await inspectContained()
  await phase('POSTSTART_INSPECT_PASS_NO_PORTS_INTERNAL_ONLY')
  report.runnerTools = JSON.parse(await docker(['exec',names.runner,'node','-e',`
    const {spawnSync}=require('node:child_process');const result=spawnSync('openssl',['version'],{encoding:'utf8'});
    if(!process.version.startsWith('v22.')||result.error||result.status!==0)throw Error('NODE22_OPENSSL_REQUIRED');
    console.log(JSON.stringify({node:process.version,openssl:result.stdout.trim()}));`]))
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      // The image's temporary initialization server accepts Unix sockets before
      // the final server exists. TCP readiness separates those two lifecycles.
      await docker(['exec', names.db, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'supabase_admin'])
      await sql('SELECT 1;'); ready = true; break
    } catch { /* bounded startup only */ }
    await new Promise(done => setTimeout(done, 500))
  }
  assert.ok(ready, 'DB_NOT_READY')
  await sql('CREATE DATABASE native_qa TEMPLATE template0;')
  const existing = new Set((await sql('SELECT rolname FROM pg_roles;')).split('\n'))
  for (const role of snapshot.roles) if (!existing.has(role.name)) {
    assert.match(role.name, /^[a-zA-Z0-9_]+$/)
    const flags = [['super', 'SUPERUSER'], ['inherit', 'INHERIT'], ['createrole', 'CREATEROLE'], ['createdb', 'CREATEDB'], ['login', 'LOGIN'], ['replication', 'REPLICATION'], ['bypass', 'BYPASSRLS']]
    await sql(`CREATE ROLE "${role.name}" ${flags.map(([key, flag]) => role[key] ? flag : `NO${flag}`).join(' ')};`)
  }
  await sql(snapshot.schema + '\n' + snapshot.platformHistory, 'native_qa')
  await sql(`ALTER DATABASE postgres ALLOW_CONNECTIONS false;
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND pid<>pg_backend_pid();
    ALTER DATABASE postgres RENAME TO qa_bootstrap;
    ALTER DATABASE qa_bootstrap ALLOW_CONNECTIONS true;
    ALTER DATABASE native_qa RENAME TO postgres;`, 'template1')
  assert.equal(await sql(securityCatalog), snapshot.securityHash, 'RESTORED_ACL_RLS_OWNER_DRIFT')
  assert.equal(await sql('SELECT count(*) FROM auth.users;SELECT count(*) FROM storage.objects;'), '0\n0')
  report.releaseUpgrade = await rehearseReleaseUpgrade(sql, phase)
  // Historical CLI migrations run as postgres. The restore administrator is
  // only a bootstrap actor; using it as the S1 definer breaks owner-only helper
  // execution in the frozen pilot contracts. Match installation provenance,
  // without granting postgres execution or changing any historical bytes.
  await sql('ALTER DATABASE postgres OWNER TO postgres;')
  report.s1Upgrade = await applyS1BrowserUpgrade((input,database)=>sql('SET ROLE postgres;\n'+input,database), phase)
  const tap = await sql(await readFile('supabase/tests/s1_serpro_nfe_gestor.test.sql', 'utf8'))
  await writeFile(resolve(root, 's1-22.tap'), tap)
  assert.match(tap, /1\.\.22/); assert.doesNotMatch(tap, /not ok|Looks like you failed/)
  report.s1Sql = { passed: 22, failed: 0 }
  await phase('S1_SQL_22_PASS')
  await sql(`ALTER ROLE postgres LOGIN PASSWORD '${password}';`)
  const { runContainedPilotRegressions } = await import('./s2-2r-contained-pilot-regressions.mjs')
  report.pilotRegressions = await runContainedPilotRegressions({ docker, names, sql, password, phase })
  const migrationPath = 'supabase/migrations/20261028195850_s2_2_serpro_operational_queue_history.sql'
  const migration = await readFile(migrationPath, 'utf8')
  await sql('SET ROLE postgres;\n'+migration)
  const recoveryPath = 'supabase/migrations/20261028204436_s2_2r_serpro_outbound_fencing_recovery.sql'
  const recovery = await readFile(recoveryPath, 'utf8')
  await sql('SET ROLE postgres;\n'+recovery)
  await sql(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text);
    INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('20261028195850','s2_2_operational');`)
  assert.equal(await sql("SELECT to_regclass('private.nfe_fiscal_pilot_authorizations') IS NULL;"), 't')
  report.migration = { path: migrationPath, sha256: createHash('sha256').update(migration).digest('hex'), independentOfPilot: true,
    recovery: {path: recoveryPath, sha256: createHash('sha256').update(recovery).digest('hex')} }
  report.operationalCatalog = JSON.parse(await sql(`SELECT jsonb_agg(jsonb_build_object(
    'identity',p.oid::regprocedure::text,'owner',p.proowner::regrole::text,'securityDefiner',p.prosecdef,'config',p.proconfig,
    'anonymousExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) ORDER BY p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'nfe_fiscal_operational_%';`))
  assert.ok(report.operationalCatalog.every(fn=>fn.securityDefiner && fn.config.some(value=>value==='search_path=""')
    && !fn.anonymousExecute && !fn.authenticatedExecute), 'RPC_CATALOG_GUARD_FAILED')
  await sql(`ALTER ROLE postgres LOGIN PASSWORD '${password}';`)
  await phase('S2_2_APPLIED_WITHOUT_PILOT_MIGRATIONS')
  const fixtureOutput = await docker(['exec', '-e', 'S22_CONTAINED_RUNNER=true', '-e', `S22_SYNTHETIC_PG_PASSWORD=${password}`,
    names.runner, 'node', 'scripts/qa/serpro/s2-2-local-operational-rehearsal.mjs', '--contained-sql'])
  report.functional = JSON.parse(fixtureOutput)
  assert.ok(report.functional.success)
  if (nativeFull) {
    for (const role of ['authenticator', 'supabase_auth_admin', 'supabase_storage_admin']) await sql(`ALTER ROLE ${role} LOGIN PASSWORD '${password}';`)
    await docker(['start', names.auth, names.rest, names.storage])
    report.nativeStartInspection = await inspectContained()
    const { runContainedNative } = await import('./s2-2r-native-contracts.mjs')
    report.native = await runContainedNative({ docker, names, envArgs, password, anon, service, root, phase,
      qualityLinux: process.argv.includes('--quality-linux') })
    if (process.argv.includes('--quality-linux')) report.buildLinux = await runLinuxProductionBuild({ docker, id,
      image: runnerImage, owned, phase, root, volume: report.dependencies.volume })
  }
  assert.deepEqual(await candidateManifest(),report.candidateSources,'SOURCE_DRIFT_DURING_CONTAINED_QA')
  report.status = 'CONTAINED_SQL_PASS'
} catch (error) {
  report.status = 'S2_2_PARTIAL_STOP'
  report.error = sanitize(error.message)
  report.errorDetails = { phase: report.stages.at(-1) ?? 'PREFLIGHT', code: error.code ?? null, transport: error.transport ?? null }
} finally {
  for (const [kind, name] of owned.reverse()) {
    try {
      if (kind === 'container') {
        const c = JSON.parse(await docker(['inspect', name]))[0]
        assert.equal(c.Config.Labels['bw.qa.s22r'], id, 'OWNERSHIP_REQUIRED_FOR_REMOVAL')
        await docker(['rm', '-f', '-v', name])
      } else if (kind === 'volume') {
        const volume = JSON.parse(await docker(['volume', 'inspect', name]))[0]
        assert.equal(volume.Labels['bw.qa.s22r'], id, 'VOLUME_OWNERSHIP_REQUIRED')
        await docker(['volume', 'rm', name])
      } else {
        const n = JSON.parse(await docker(['network', 'inspect', name]))[0]
        assert.equal(n.Labels['bw.qa.s22r'], id)
        await docker(['network', 'rm', name])
      }
    } catch (error) { report.cleanupError = sanitize(error.message); report.cleanupErrorTransport = error.transport ?? null }
  }
  report.after = await inventory()
  report.preexistingPreserved = Object.keys(before).every(kind => before[kind].every(item => report.after[kind].includes(item)))
  report.noNewResourcesRemain = Object.keys(before).every(kind => report.after[kind].every(item => before[kind].includes(item)))
  report.DOCKER_TEST_ENV_CLEANUP = !report.cleanupError && report.preexistingPreserved && report.noNewResourcesRemain ? 'PASS' : 'FAIL'
  report.finishedAt = new Date().toISOString()
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, report: resolve(root, 'report.json'), cleanup: report.DOCKER_TEST_ENV_CLEANUP }))
  if (report.error) console.error(report.error)
  if (report.status !== 'CONTAINED_SQL_PASS' || report.DOCKER_TEST_ENV_CLEANUP !== 'PASS') process.exitCode = 1
}
