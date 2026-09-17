#!/usr/bin/env node
// One synthetic aged object without a signed URL, for safe cleanup rehearsal.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
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
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 })
await db.connect()
try {
  const fixture = (await db.query(`select id,user_id,cnpj from public.cedentes
    where razao_social='QA P9.1 Cedente' and user_id is not null order by created_at desc limit 1`)).rows[0]
  if (!fixture) throw new Error('Fixture sintetica P9.1 nao encontrada')
  const intentId = randomUUID()
  const path = `${fixture.cnpj}/contrato_social/${intentId}_qa-p93-cleanup.pdf`
  const bytes = Buffer.from('%PDF-1.4\n% QA P9.3 synthetic orphan; no signed URL was issued\n%%EOF\n')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: uploadError } = await admin.storage.from('documentos-cedentes').upload(path, bytes,
    { contentType: 'application/pdf', upsert: false })
  if (uploadError) throw new Error(`Fixture Storage falhou: ${uploadError.message}`)
  const createdAt = new Date(Date.now() - 4 * 60 * 60_000)
  const expiresAt = new Date(createdAt.getTime() + 15 * 60_000)
  const cleanupAfter = new Date(createdAt.getTime() + 3 * 60 * 60_000)
  try {
    await db.query(`insert into public.documento_upload_intents
      (id,cedente_id,usuario_id,tipo_documento,storage_path,nome_original,mime_type,tamanho_esperado,
       status,expires_at,cleanup_after,created_at,updated_at,last_error_code)
      values ($1,$2,$3,'contrato_social',$4,'qa-p93-cleanup.pdf','application/pdf',$5,
        'FAILED',$6,$7,$8,$8,'QA_SIMULATED_FINALIZE_FAILURE')`,
    [intentId, fixture.id, fixture.user_id, path, bytes.length, expiresAt, cleanupAfter, createdAt])
  } catch (error) {
    await admin.storage.from('documentos-cedentes').remove([path])
    throw error
  }
  console.log(JSON.stringify({ projectRef: ref, intentId, status: 'FAILED', synthetic: true,
    signedUrlIssued: false, documentCreated: false, cleanupEligible: true }))
} finally { await db.end() }
