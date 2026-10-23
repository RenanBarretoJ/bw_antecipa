import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connectDuplicatasPreview } from './preview-db.mjs'

assert(process.argv.slice(2).every(a => a === '--apply'))
const apply = process.argv.includes('--apply')
const version = '20261022211047', name = 'vrs_duplicata_parcela_keys'
const sql = readFileSync(new URL(`../../../supabase/migrations/${version}_${name}.sql`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const output = resolve(process.env.LOCALAPPDATA || process.env.TMPDIR || '/tmp', 'bw-antecipa-evidence', `vrs-preview-${Date.now()}`)
mkdirSync(output, { recursive: true })
const hash = value => createHash('sha256').update(value).digest('hex')
assert.equal(hash(sql), '7766790adef7f656eda3fefa25dde465204f5d73e0983f37aec881d6ba81b563')
const report = { project: 'phdckowbexkkvuwnzeaf', migration: version, sha256: hash(sql), apply, applied: false, preserved: false, passed: false }
let db
try {
  ;({ db } = await connectDuplicatasPreview())
  const capture = async () => ({
    business: (await db.query("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') rows from public.remessa_operacional_chaves t")).rows,
    acl: (await db.query("select relacl::text,relrowsecurity,relforcerowsecurity from pg_class where oid='public.remessa_operacional_chaves'::regclass")).rows,
    policies: (await db.query("select * from pg_policies where tablename='remessa_operacional_chaves' order by policyname")).rows,
    constraints: (await db.query("select conname,pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.remessa_operacional_chaves'::regclass and conname not in ('remessa_operacional_chaves_ativo_check','remessa_operacional_chaves_parcela_check') order by conname")).rows,
    history: (await db.query('select version,name,md5(statements::text) hash from supabase_migrations.schema_migrations where version<>$1 order by version', [version])).rows,
  })
  const before = await capture()
  const existing = (await db.query('select statements from supabase_migrations.schema_migrations where version=$1', [version])).rows
  if (existing.length) assert.equal(existing[0].statements.join('\n').replaceAll('\r\n', '\n').trim(), sql.trim())
  else if (apply) {
    await db.query('set default_transaction_read_only=off')
    await db.query('begin read write')
    try {
      await db.query('select pg_advisory_xact_lock(20261022,211047)')
      await db.query(sql)
      assert.deepEqual(await capture(), before)
      await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)', [version, name, [sql]])
      await db.query('commit'); report.applied = true
    } catch (error) { await db.query('rollback'); throw error }
  }
  assert.deepEqual(await capture(), before)
  report.preserved = true; report.passed = true
} catch (error) {
  report.error = { code: error.code ?? null, reason: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'PREVIEW_MIGRATION_FAILED_NO_RAW_DETAILS' }; process.exitCode = 1
} finally {
  await db?.end().catch(() => {})
  writeFileSync(resolve(output, 'REPORT.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, ...report }))
}
