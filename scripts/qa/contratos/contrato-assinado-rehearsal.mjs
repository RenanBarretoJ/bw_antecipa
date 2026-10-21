// SQL real, somente Docker local descartavel. A fonte e lida apenas via pg_dump
// schema-only; nao copiamos registros nem modificamos a stack preexistente.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'

const source = process.argv[2]
if (!source?.startsWith('supabase_db_')) throw new Error('Informe uma stack Supabase local como fonte do schema.')
if (process.env.DOCKER_HOST && !/^(npipe:|unix:)/.test(process.env.DOCKER_HOST)) throw new Error('Docker remoto proibido.')
const suffix = Date.now().toString()
const target = `bw_signed_contract_${suffix}`
const label = `bw.signed-contract-rehearsal=${suffix}`
const password = randomBytes(32).toString('hex') // Credencial descartavel, nunca exibida.
const migrationPath = resolve('supabase/migrations/20261020160000_cedente_contrato_assinado_canonico.sql')
const migration = readFileSync(migrationPath, 'utf8')
const report = { sourceSchemaOnly: source, target, migrationSha256: createHash('sha256').update(migration).digest('hex'), gates: {}, DOCKER_TEST_ENV_CLEANUP: 'PENDING' }
let created = false
let sqlNotices = ''
const generatedFiles = []
function docker(args, input, check = true) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 })
  if (check && (r.error || r.status !== 0)) throw new Error(`Docker ${args[0]}: ${r.error?.code || r.stderr.slice(-1500)}`)
  return r
}
function sql(input) {
  const args = ['exec', '-i', '-e', `PGPASSWORD=${password}`, target, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'signed_contract_test']
  let stdin = input
  if (Buffer.byteLength(input) > 65536) {
    // No Windows, evite enfileirar o dump grande no stdin de docker exec.
    // O artefato nasce aqui, nao contem dados e seus bytes sao conferidos.
    const directory = mkdtempSync(join(tmpdir(), 'bw-signed-contract-schema-'))
    const file = join(directory, 'schema.sql')
    generatedFiles.push({ directory, file })
    writeFileSync(file, input)
    docker(['cp', file, `${target}:/tmp/qa-contract-schema.sql`])
    const expected = createHash('sha256').update(input).digest('hex')
    const received = docker(['exec', target, 'sha256sum', '/tmp/qa-contract-schema.sql']).stdout.split(/\s+/)[0]
    if (received !== expected) throw new Error('Hash divergente no transporte do schema.')
    args.push('-f', '/tmp/qa-contract-schema.sql')
    stdin = undefined
    report.gates.schemaTransportHash = 'PASS'
  }
  const r = docker(args, stdin)
  sqlNotices = r.stderr
  return r.stdout
}
try {
  const endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).stdout.trim()
  if (!/^(npipe:|unix:)/.test(endpoint)) throw new Error('Contexto Docker nao local.')
  const image = docker(['inspect', source, '--format', '{{.Config.Image}}']).stdout.trim()
  if (!image.includes('supabase/postgres:')) throw new Error('Imagem fonte inesperada.')
  const dump = docker(['exec', source, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only', '--no-owner', '--no-publications', '--no-subscriptions']).stdout
  report.schemaSha256 = createHash('sha256').update(dump).digest('hex')
  docker(['run', '-d', '--name', target, '--network', 'none', '--label', label, '--tmpfs', '/var/lib/postgresql/data', '-e', 'PGDATA=/var/lib/postgresql/data', '-e', `POSTGRES_PASSWORD=${password}`, image, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf', '-c', 'listen_addresses=127.0.0.1'])
  created = true
  let ready = false
  let pidOne = ''
  for (let i = 0; i < 45; i++) {
    // initdb usa um servidor temporario que tambem responde ao pg_isready.
    // Espere o entrypoint concluir e entregar o PID 1 ao servidor definitivo.
    pidOne = docker(['exec', target, 'cat', '/proc/1/comm'], undefined, false).stdout.trim()
    if (['postgres', '.postgres-wrapp'].includes(pidOne) && docker(['exec', target, 'pg_isready', '-U', 'supabase_admin'], undefined, false).status === 0) { ready = true; break }
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!ready) {
    report.initializationDiagnostic = {
      pidOne,
      processes: docker(['exec', target, 'ps', '-eo', 'pid,comm'], undefined, false).stdout,
      log: docker(['logs', '--tail', '14', target], undefined, false).stderr.replaceAll(password, '[REDACTED]').replace(/[a-f0-9]{64}/gi, '[REDACTED]'),
    }
    throw new Error('Postgres local nao inicializou.')
  }
  report.gates.initialization = 'PASS'
  docker(['exec', '-e', `PGPASSWORD=${password}`, target, 'createdb', '-U', 'supabase_admin', 'signed_contract_test'])
  // O entrypoint da CLI cria roles auxiliares alem das presentes na imagem.
  // Reproduza somente nomes/atributos publicos das roles ausentes, sem senhas,
  // antes de restaurar os grants exatos do dump. Nao altere roles existentes.
  const roles = JSON.parse(docker(['exec', source, 'psql', '-XAt', '-U', 'supabase_admin', '-d', 'postgres', '-c',
    "select coalesce(json_agg(json_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createrole',rolcreaterole,'createdb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypass',rolbypassrls)), '[]') from pg_roles where rolname !~ '^pg_'",
  ]).stdout)
  const existing = new Set(sql('SELECT rolname FROM pg_roles;').trim().split(/\r?\n/).map(s => s.trim()))
  report.bootstrapRoles = []
  for (const role of roles) {
    if (existing.has(role.name)) continue
    const flags = [['super','SUPERUSER'],['inherit','INHERIT'],['createrole','CREATEROLE'],['createdb','CREATEDB'],['login','LOGIN'],['replication','REPLICATION'],['bypass','BYPASSRLS']]
    sql(`CREATE ROLE "${role.name.replaceAll('"','""')}" ${flags.map(([key, flag]) => role[key] ? flag : `NO${flag}`).join(' ')};`)
    report.bootstrapRoles.push(role.name)
  }
  sql(dump)
  report.gates.schemaRestore = 'PASS'
  const preservationQuery = `SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname)::text,'')) FROM pg_policies p;
    SELECT md5(coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl) ORDER BY n.nspname,c.relname)::text,''))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','auth','storage') AND c.relkind IN ('r','p');`
  const before = sql(preservationQuery)
  sql(migration)
  report.gates.migration = 'PASS'
  if (sql(preservationQuery) !== before) throw new Error('RLS/policies/grants de tabelas divergiram.')
  report.gates.policiesRlsTableGrantsPreserved = 'PASS'
  const output = sql(readFileSync(resolve('supabase/tests/cedente_contrato_assinado.sql'), 'utf8'))
  report.sqlAssertions = [...sqlNotices.matchAll(/NOTICE:\s+PASS: ([^\r\n]+)/g)].map(m => m[1])
  if (!report.sqlAssertions.length) throw new Error('SQL terminou sem assertions comprovadas.')
  report.sqlOutputSha256 = createHash('sha256').update(output + sqlNotices).digest('hex')
  console.log(`${report.sqlAssertions.length} assertions SQL aprovadas.`)
  report.gates.sql = 'PASS'
} catch (error) {
  report.error = error.message
  process.exitCode = 1
  console.error(error.message)
} finally {
  if (created) {
    const owned = docker(['inspect', target, '--format', '{{index .Config.Labels "bw.signed-contract-rehearsal"}}'], undefined, false).stdout.trim()
    if (owned === suffix) {
      docker(['rm', '-f', '-v', target])
      const remains = docker(['ps', '-a', '--filter', `name=^/${target}$`, '--format', '{{.Names}}']).stdout.trim()
      report.DOCKER_TEST_ENV_CLEANUP = remains ? 'FAIL' : 'PASS'
    } else { report.DOCKER_TEST_ENV_CLEANUP = 'OWNERSHIP_MISMATCH'; process.exitCode = 1 }
  } else report.DOCKER_TEST_ENV_CLEANUP = 'NOT_CREATED'
  for (const { directory, file } of generatedFiles) {
    // Remocao nao recursiva, somente dos caminhos criados por mkdtemp acima.
    unlinkSync(file)
    rmdirSync(directory)
  }
  // Evidencia sanitizada produzida pelo ensaio; nao contem dump nem credenciais.
  const output = resolve(`rehearsal/reports/cedente-contrato-assinado-${suffix}.json`)
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Relatorio: ${output}`)
}
