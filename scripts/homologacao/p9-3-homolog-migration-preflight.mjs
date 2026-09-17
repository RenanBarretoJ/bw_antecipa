#!/usr/bin/env node
// Transactional DDL dry-run against the actual homolog schema; never commits.
import { readFileSync } from 'node:fs'
import pg from 'pg'

for (const line of readFileSync('.env.homolog', 'utf8').split(/\r?\n/)) {
  const split = line.indexOf('=')
  if (split < 1 || line.trimStart().startsWith('#')) continue
  const key = line.slice(0, split).trim()
  let value = line.slice(split + 1).trim()
  if (/^['"]/.test(value) && value[0] === value.at(-1)) value = value.slice(1, -1)
  if (!(key in process.env)) process.env[key] = value
}
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
if (ref !== 'fhgkmggthxikfpogrvaa' || ref === process.env.SUPABASE_PRODUCTION_PROJECT_REF) throw new Error('Destino nao e homolog')
const url = new URL(process.env.SUPABASE_DB_URL)
if (!url.hostname.includes(ref) && !decodeURIComponent(url.username).includes(ref)) throw new Error('Database URL nao pertence ao projeto homolog')
url.password = process.env.SUPABASE_PASSWORD
const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 })
const sql = readFileSync('supabase/migrations/20260916205302_p9_3_documento_upload_intents.sql', 'utf8')
const sqlCascade = readFileSync('supabase/migrations/20260916210153_p9_3_intents_documento_fk_cascade.sql', 'utf8')
await client.connect()
try {
  const primaryApplied = (await client.query("select to_regclass('public.documento_upload_intents') is not null as applied")).rows[0].applied
  const cascadeApplied = primaryApplied && (await client.query(`select count(*)::int as n from pg_constraint
    where conrelid='public.documento_upload_intents'::regclass and conname in
    ('documento_upload_intents_documento_id_fkey','documento_upload_intents_documento_versao_id_fkey') and confdeltype='c'`)).rows[0].n === 2
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    await client.query('BEGIN')
    try {
      if (!primaryApplied) await client.query(sql)
      if (!cascadeApplied) await client.query(sqlCascade)
      const schema = await client.query(`select relrowsecurity from pg_class where oid='public.documento_upload_intents'::regclass`)
      const rpc = await client.query(`select to_regprocedure('public.finalizar_documento_upload_intent(uuid)') is not null as exists`)
      const cascade = await client.query(`select count(*)::int as n from pg_constraint
        where conrelid='public.documento_upload_intents'::regclass and conname in
        ('documento_upload_intents_documento_id_fkey','documento_upload_intents_documento_versao_id_fkey') and confdeltype='c'`)
      if (!schema.rows[0]?.relrowsecurity || !rpc.rows[0]?.exists || cascade.rows[0].n !== 2) throw new Error('Schema/RLS/RPC/FK incompletos')
      console.log(JSON.stringify({ projectRef: ref, cycle, primaryApplied, cascadeApplied, migration: 'PASS', committed: false }))
    } finally { await client.query('ROLLBACK') }
  }
} finally { await client.end() }
