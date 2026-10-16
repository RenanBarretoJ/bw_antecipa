import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

if (process.env.NF_ORIGINAL_LOCAL_QA !== 'true' || !process.env.LOCAL_QA_PG_PASSWORD) {
  throw new Error('Requires explicit disposable local QA configuration.')
}

const db = new Client({ host: '127.0.0.1', port: 57862, database: 'postgres',
  user: 'postgres', password: process.env.LOCAL_QA_PG_PASSWORD })
await db.connect()
try {
  await db.query('BEGIN')
  await db.query("SET LOCAL statement_timeout = '20s'")
  const { rows } = await db.query("SELECT to_regprocedure('public.fiscal_intake_get_originals(uuid[])') AS existing")
  if (!rows[0].existing) {
    await db.query(readFileSync(resolve('supabase/migrations/20261015232041_fiscal_originals_approval_batch.sql'), 'utf8'))
  }
  const assertions = readFileSync(resolve('supabase/tests/fiscal_originals_approval.assert.sql'), 'utf8')
    .replace(/^BEGIN;$/m, '').replace(/^ROLLBACK;$/m, '')
  await db.query(assertions)
  console.log('PASS: canonical PDF/XML, missing object, journal fences, viewer equivalence and least-privilege grants; rollback-only local QA.')
} finally {
  await db.query('ROLLBACK').catch(() => {})
  await db.end()
}
