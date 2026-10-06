// Local-only fresh/upgrade rehearsal. No environment files or remote credentials.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import pg from 'pg'

assert.equal(process.argv.length, 2)
const inspect = spawnSync('docker', ['inspect', 'supabase_db_notificacoes-r1-20261005', '--format', '{{index .Config.Labels "com.supabase.cli.project"}}'], { encoding: 'utf8', windowsHide: true })
assert.equal(inspect.status, 0)
assert.equal(inspect.stdout.trim(), 'notificacoes-r1-20261005')
const db = new pg.Client({ host: '127.0.0.1', port: 59422, user: 'postgres', password: 'postgres', database: 'postgres' })
const files = ['supabase/migrations/20261005213812_notificacoes_fund_scope.sql', 'supabase/migrations/20261006114841_notificacoes_shared_cedente_producers.sql', 'supabase/migrations/20261006124134_notificacoes_entity_producers.sql', 'supabase/migrations/20261006130657_notificacoes_scoped_ui.sql']
const sql = files.map(file => readFileSync(file, 'utf8'))
const fixture = readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql', 'utf8')
const tests = readFileSync('supabase/tests/notificacoes_shared_cedente.sql', 'utf8')
const evidence = []
await db.connect()
try {
  for (const mode of ['fresh', 'upgrade']) {
    await db.query('BEGIN')
    try {
      await db.query("SET LOCAL statement_timeout='20s'; CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions; SET LOCAL search_path=public,extensions")
      await db.query(fixture)
      if (mode === 'upgrade') await db.query(`INSERT INTO public.notificacoes(id,usuario_id,titulo,mensagem,tipo)
        VALUES('2f000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000004','Historico QA','Sem entidade comprovada','info')`)
      await db.query(sql[0])
      const before = await db.query('SELECT * FROM public.notificacoes ORDER BY id')
      for (const migration of sql.slice(1)) await db.query(migration)
      assert.deepEqual((await db.query('SELECT * FROM public.notificacoes ORDER BY id')).rows, before.rows, 'R2 changed existing history')
      const results = await db.query(tests)
      const tap = results.flatMap(result => result.rows.flatMap(row => Object.values(row))).filter(value => typeof value === 'string')
      assert(tap.includes('1..25'), 'Missing TAP plan')
      const failures = tap.filter(line => /^not ok|^# Looks like/.test(line))
      assert.deepEqual(failures, [], failures.join('\n'))
      assert.equal(tap.filter(line => /^ok \d+/.test(line)).length, 25)
      evidence.push({ mode, checks: 25, passed: true, historyUnchanged: true })
    } finally { await db.query('ROLLBACK') }
  }
  const report = { at: new Date().toISOString(), target: '127.0.0.1:59422', evidence,
    migrations: files.map((file,index) => ({ file, sha256: createHash('sha256').update(sql[index]).digest('hex') })),
    success: true, allChangesRolledBack: true }
  writeFileSync('rehearsal/reports/NOTIFICACOES_SHARED_CADASTRO_TEST.json', JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report))
} finally { await db.end() }
