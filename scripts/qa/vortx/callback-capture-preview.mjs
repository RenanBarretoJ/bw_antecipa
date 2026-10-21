// Explicitly authorized Preview only. No provider request, import or production/homolog write.
import assert from 'node:assert/strict'
import { constants, createDecipheriv, createHash, generateKeyPairSync, privateDecrypt, randomUUID, X509Certificate } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { manifest, previewDetails, assertPreviewDetails, repository } from './preview-runtime.mjs'

const apply = process.argv.includes('--apply'), arm = process.argv.includes('--arm')
const exportPath = process.argv.find(a => a.startsWith('--export='))?.slice(9)
const captureFile = process.argv.find(a => a.startsWith('--capture='))?.slice(10)
assert(!(apply && arm), 'SEPARATE_MIGRATION_AND_ARMING_STEPS')
assert(!exportPath || captureFile, 'EXPORT_REQUIRES_EXACT_CAPTURE_MANIFEST')
const sha = value => createHash('sha256').update(value).digest('hex')
const base = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-callback-capture-20261020')
const output = join(base, `${apply ? 'apply' : arm ? 'arm' : exportPath ? 'export' : 'preflight'}-${Date.now()}`)
mkdirSync(output, { recursive: true })
const entries = [
  { version: '20261020160000', name: 'cedente_contrato_assinado_canonico' },
  { version: '20261020165910', name: 'vortx_callback_single_capture_preview' },
].map(e => {
  const path = `supabase/migrations/${e.version}_${e.name}.sql`, sql = readFileSync(resolve(repository, path), 'utf8')
  return { ...e, path, sql, sha256: sha(sql) }
})
const report = { project: manifest.projectRef, output, apply, arm, entries: entries.map(e => ({ version: e.version, name: e.name, path: e.path, sha256: e.sha256 })),
  applied: [], productionChanged: false, homologChanged: false, providerRequestSent: false, error: null }
let db
try {
  assert.equal(manifest.projectRef, 'phdckowbexkkvuwnzeaf')
  const details = assertPreviewDetails(previewDetails())
  const caSource = 'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt'
  const caResponse = await fetch(caSource, { redirect: 'error', signal: AbortSignal.timeout(15000) })
  assert(caResponse.ok, 'OFFICIAL_CA_DOWNLOAD_FAILED')
  const ca = await caResponse.text(), cert = new X509Certificate(ca)
  assert(cert.ca && cert.subject.includes('Supabase') && cert.verify(cert.publicKey) && Date.parse(cert.validTo) > Date.now())
  assert.equal(cert.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA', 'SUPABASE_ROOT_CA_FINGERPRINT_MISMATCH')
  report.tls = { caSource, fingerprint256: cert.fingerprint256, rejectUnauthorized: true, verifyHostname: true }
  const connection = new URL(details.POSTGRES_URL)
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) connection.searchParams.delete(key)
  db = new pg.Client({ connectionString: connection.toString(), ssl: { ca, rejectUnauthorized: true, servername: connection.hostname }, connectionTimeoutMillis: 20000 })
  await db.connect(); await db.query("set statement_timeout='30s'; set lock_timeout='3s'")
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=ANY($1)', [[manifest.originalA6Version, '20261019192624']])).rows[0].n, 0,
    'A6_AND_NATIVE_STOCK_MUST_REMAIN_UNAPPLIED')
  report.originalA6Applied = false; report.nativeStockApplied = false
  const fingerprint = async () => {
    const rows = {}
    for (const table of ['public.fundos', 'public.integracoes_fundo', 'public.integracao_fundo_versoes', 'public.cedentes',
      'public.logs_auditoria', 'storage.objects', 'public.vortx_relatorio_solicitacoes', 'public.vortx_relatorio_eventos', 'private.vortx_callback_endpoints']) {
      rows[table] = (await db.query(`select count(*)::int n,md5(coalesce(string_agg(row_to_json(t)::text,'|' order by id),'')) hash from ${table} t`)).rows[0]
    }
    const policies = (await db.query("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies order by schemaname,tablename,policyname")).rows
    return { rows, policyHash: sha(JSON.stringify(policies)) }
  }
  report.before = await fingerprint()
  const history = (await db.query('select version,name,statements from supabase_migrations.schema_migrations where version=ANY($1)', [entries.map(e => e.version)])).rows
  for (const row of history) {
    const entry = entries.find(e => e.version === row.version)
    assert.equal(row.name, entry.name)
    assert.deepEqual(row.statements, [entry.sql], 'EXISTING_MIGRATION_BYTES_DIFFER')
  }
  report.existingVerified = history.map(h => h.version)
  if (apply) {
    const qualityName = readdirSync(base).filter(n => n.startsWith('quality-')).sort().at(-1)
    const quality = JSON.parse(readFileSync(join(base, qualityName, 'QUALITY.json'), 'utf8'))
    assert.equal(quality.checks.length, 5); assert(quality.checks.every(c => c.exitCode === 0))
    const sqlBase = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-callback-20261019')
    const sqlRuns = readdirSync(sqlBase).filter(n => n.startsWith('sql-')).sort().reverse()
    report.incompleteHistoricalSqlRuns = sqlRuns.filter(n => !existsSync(join(sqlBase, n, 'REPORT.json')))
    const certified = sqlRuns.filter(n => existsSync(join(sqlBase, n, 'REPORT.json')))
      .map(n => JSON.parse(readFileSync(join(sqlBase, n, 'REPORT.json'), 'utf8')))
      .find(r => !r.error && r.DOCKER_TEST_ENV_CLEANUP && r.stacks.length === 2 && r.stacks.every(s => s.checks.length >= 71)
        && r.migrations.some(m => m.path === entries[1].path && m.sha256 === entries[1].sha256))
    assert(certified, 'EXACT_CAPTURE_SOURCE_NOT_CERTIFIED_IN_TWO_STACKS')
    const contract = JSON.parse(readFileSync(resolve(repository, 'rehearsal/reports/cedente-contrato-assinado-vortx-closeout-20261020.json'), 'utf8'))
    assert.equal(contract.database.migrationSha256, entries[0].sha256)
    assert.equal(contract.validation.sql.assertions, 30); assert.equal(contract.validation.sql.DOCKER_TEST_ENV_CLEANUP, 'PASS')
    await db.query('begin')
    try {
      for (const e of entries.filter(e => !history.some(h => h.version === e.version))) {
        const body = e.sql.replace(/(^|\n)BEGIN;\s*\r?\n/, '$1').replace(/\bCOMMIT;\s*$/, '')
        assert.notEqual(body, e.sql)
        await db.query(body)
        await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)', [e.version, e.name, [e.sql]])
        report.applied.push({ version: e.version, name: e.name, sha256: e.sha256 })
      }
      assert.deepEqual(await fingerprint(), report.before, 'BUSINESS_ROWS_OR_RLS_POLICIES_CHANGED')
      await db.query("notify pgrst,'reload schema'"); await db.query('commit')
    } catch (error) { await db.query('rollback'); report.applied = []; throw error }
  }
  if (arm) {
    assert.equal(history.length, 2, 'MIGRATIONS_NOT_YET_VERIFIED')
    const existing = (await db.query("select count(*)::int n from private.vortx_callback_capturas_temporarias where capturar_ate>clock_timestamp() and reservada_em is null")).rows[0].n
    assert.equal(existing, 0, 'ANOTHER_ACTIVE_DIAGNOSTIC_WINDOW_EXISTS')
    const endpoint = (await db.query('select id,fundo_id,revisao from private.vortx_callback_endpoints where ativo')).rows
    assert.equal(endpoint.length, 1, 'AMBIGUOUS_PREVIEW_ENDPOINT')
    const privateBase = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-private/vortx-callback-capture')
    mkdirSync(privateBase, { recursive: true })
    const directory = mkdtempSync(join(privateBase, 'capture-'))
    const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
    writeFileSync(join(directory, 'private-key.pem'), keys.privateKey, { mode: 0o600, flag: 'wx' })
    writeFileSync(join(directory, 'public-key.pem'), keys.publicKey, { mode: 0o600, flag: 'wx' })
    const id = randomUUID(), e = endpoint[0]
    const window = (await db.query(`insert into private.vortx_callback_capturas_temporarias(id,endpoint_id,fundo_id,revisao,capturar_ate,expira_em)
      values($1,$2,$3,$4,clock_timestamp()+interval '110 minutes',clock_timestamp()+interval '23 hours')
      returning id,capturar_ate,expira_em`, [id, e.id, e.fundo_id, e.revisao])).rows[0]
    const file = join(directory, 'capture.json')
    const capture = { project: manifest.projectRef, branch: manifest.branch, id, endpointId: e.id, fundoId: e.fundo_id, revisao: e.revisao,
      capturarAte: window.capturar_ate.toISOString(), expiraEm: window.expira_em.toISOString(), privateKeyPath: join(directory, 'private-key.pem'), publicKeyPath: join(directory, 'public-key.pem') }
    writeFileSync(file, JSON.stringify(capture, null, 2), { mode: 0o600, flag: 'wx' })
    report.capture = { ...capture, manifestPath: file }
    // PUBLIC key and non-secret identifiers only. The private key is NEVER exported or logged.
    console.log(JSON.stringify({ capture: report.capture, publicKeyPem: keys.publicKey }))
  }
  if (exportPath) {
    const capture = JSON.parse(readFileSync(resolve(captureFile), 'utf8'))
    assert.equal(capture.project, manifest.projectRef); assert.equal(capture.branch, manifest.branch)
    const row = (await db.query(`select id,endpoint_id,fundo_id,revisao,payload_criptografado,hash_captura,corpo_completo
      from private.vortx_callback_capturas_temporarias where id=$1 and expira_em>clock_timestamp() and concluida_em is not null`, [capture.id])).rows[0]
    assert(row, 'NO_COMPLETED_UNEXPIRED_CAPTURE')
    assert.equal(row.endpoint_id, capture.endpointId); assert.equal(row.fundo_id, capture.fundoId); assert.equal(row.revisao, capture.revisao)
    const [format, wrapped, iv, tag, encrypted] = row.payload_criptografado.split(':')
    assert.equal(format, 'rsa1')
    const secret = privateDecrypt({ key: readFileSync(capture.privateKeyPath), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(wrapped, 'base64url'))
    const cipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(iv, 'base64url'))
    cipher.setAAD(Buffer.from(`VORTX_CALLBACK_APPLICATION_REQUEST_V1:${capture.id}`)); cipher.setAuthTag(Buffer.from(tag, 'base64url'))
    const plaintext = Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64url')), cipher.final()]).toString('utf8')
    assert.equal(sha(plaintext), row.hash_captura)
    const envelope = JSON.parse(plaintext)
    assert.equal(envelope.purpose, 'VORTX_CALLBACK_APPLICATION_REQUEST_V1'); assert.equal(envelope.capturaId, capture.id)
    assert.equal(envelope.endpointId, row.endpoint_id); assert.equal(envelope.fundoId, row.fundo_id)
    const bytes = Buffer.from(envelope.corpoBase64, 'base64')
    assert.equal(sha(bytes), envelope.hashCorpo); assert.equal(bytes.length, envelope.bytesCorpo)
    writeFileSync(resolve(exportPath), plaintext, { mode: 0o600, flag: 'wx' })
    report.export = { path: resolve(exportPath), sha256: sha(plaintext), bytesCorpo: bytes.length, corpoCompleto: row.corpo_completo,
      statusHttp: envelope.statusHttp, nivelCaptura: envelope.nivelCaptura }
    // No headers, URL, query or plaintext body in stdout or the public report.
  }
  report.after = await fingerprint(); assert.deepEqual(report.after, report.before)
  report.preservedBusinessRowsAndPolicies = true
} catch (error) {
  report.error = { name: error.name, code: error.code ?? null,
    reason: error.code === 'ERR_ASSERTION' ? error.message.slice(0, 180) : 'PREVIEW_OPERATION_FAILED_NO_RAW_DETAILS' }
  process.exitCode = 1
} finally {
  if (db) await db.end()
  writeFileSync(join(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, apply, arm, applied: report.applied, preserved: report.preservedBusinessRowsAndPolicies, export: report.export, error: report.error }))
}
