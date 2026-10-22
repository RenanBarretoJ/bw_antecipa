import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import pg from 'pg'

// Banco descartavel exclusivo do P16; nunca aceita conexao remota.
const db = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:56322/postgres' })
const baseline = JSON.parse(readFileSync('docs/analises/p16-prod-preflight.json', 'utf8'))
const version = '20260928185439'
const name = 'p16_liberar_nf_de_operacao_cancelada'
const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8')
const hash = createHash('sha256').update(sql).digest('hex')
assert.equal(hash, baseline.migrationSha256)
const equivalence = []
await db.connect()
try {
  assert.equal((await db.query('select max(version) as version from supabase_migrations.schema_migrations')).rows[0].version, '20260925205512')
  for (const expected of baseline.functions) {
    const actual = (await db.query('select pg_get_functiondef($1::regprocedure) as definition,proacl::text as acl from pg_proc where oid=$1::regprocedure', [expected.signature])).rows[0]
    assert.equal(actual.definition.replace(/\r\n/g, '\n'), expected.definition.replace(/\r\n/g, '\n'))
    assert.equal(actual.acl, expected.acl)
    equivalence.push({ signature: expected.signature, definitionAndAcl: 'MATCH' })
  }
  const before = (await db.query('select s::text as status,private.operacao_status_reserva_nf(s) as reserves from unnest(enum_range(null::public.operacao_status)) s')).rows
  for (const row of before) assert.equal(row.reserves, row.status !== 'reprovada')
  await db.query('begin')
  await db.query(sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''))
  await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values ($1,$2,$3)', [version, name, [sql]])
  await db.query('commit')
  const output = execFileSync(process.execPath, ['scripts/homologacao/p16/verify-local.mjs', '--concurrency'], { encoding: 'utf8' })
  process.stdout.write(output)
  const checks = output.split(/\r?\n/).filter(line => line.startsWith('PASS ')).map(line => line.slice(5))
  assert.equal(checks.length, 17)
  assert.ok(checks.includes('concurrency_one_winner_one_denied_one_active'))
  writeFileSync('docs/analises/p16-prod-rehearsal.json', JSON.stringify({
    result: 'PASS', testedAt: new Date().toISOString(), migrationSha256: hash,
    target: 'local:56322/bw-antecipa-p16-clean-room', baselineVersion: '20260925205512',
    baselineEquivalence: equivalence, baselineMatrix: before, checks,
    scope: 'SQL real e duas sessoes concorrentes; sete funcoes e ACLs iguais a producao, normalizando apenas CRLF. Sem dados reais.'
  }, null, 2) + '\n')
} finally {
  await db.query('rollback').catch(() => {})
  await db.end()
}
