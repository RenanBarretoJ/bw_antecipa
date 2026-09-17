#!/usr/bin/env node
// Read-only by default. Only QA P9.1 objects in homolog may be removed, by exact path.
import { readFileSync } from 'node:fs'
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
const required = (key) => {
  if (!process.env[key]) throw new Error(`${key} ausente`)
  return process.env[key]
}
const ref = new URL(required('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
if (ref !== 'fhgkmggthxikfpogrvaa' || ref === required('SUPABASE_PRODUCTION_PROJECT_REF')) throw new Error('Destino nao e homolog')
const databaseUrl = new URL(required('SUPABASE_DB_URL'))
databaseUrl.password = required('SUPABASE_PASSWORD')
const args = process.argv.slice(2)
const exactPath = args.includes('--path') ? args[args.indexOf('--path') + 1] : undefined
const execute = args.includes('--execute')
if (execute) throw new Error('P9.3: cleanup por path desabilitado; use p9-3-upload-intents-reconciler.mjs com --intent-id exato.')
const confirmation = args.includes('--confirm') ? args[args.indexOf('--confirm') + 1] : undefined
const qaPathPattern = /^\d{14}\/[a-z_]+\/[0-9a-f-]{36}_qa-p91-[a-z0-9_.-]+\.pdf$/i
if (args.includes('--path') && (!exactPath || exactPath.startsWith('--'))) throw new Error('--path exige caminho exato')
if (execute && (!exactPath || confirmation !== `REMOVER_ORFAO_QA_${ref}`)) throw new Error('Execucao exige --path exato e --confirm REMOVER_ORFAO_QA_<ref>')
if (exactPath && !qaPathPattern.test(exactPath)) throw new Error('Path fora do namespace QA P9.1')

const db = new pg.Client({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 })
await db.connect()
try {
  const query = `select o.name, o.created_at, c.id as cedente_id,
      exists(select 1 from public.documentos d where d.url_arquivo=o.name) as referenced
    from storage.objects o
    join public.cedentes c on c.cnpj=split_part(o.name,'/',1) and c.razao_social='QA P9.1 Cedente'
    where o.bucket_id='documentos-cedentes'
      and o.name like '%qa-p91-%'
      and ($1::text is null or o.name=$1)
    order by o.created_at desc, o.name desc limit 200 offset $2`
  const rows = []
  for (let offset = 0; offset < 10000; offset += 200) {
    const page = (await db.query(query, [exactPath || null, offset])).rows
    rows.push(...page)
    if (page.length < 200) break
    if (offset === 9800) throw new Error('Mais de 10000 objetos QA: paginacao segura exige revisao manual')
  }
  const now = Date.now()
  const classify = (row) => !qaPathPattern.test(row.name) ? 'UNKNOWN' : row.referenced ? 'REFERENCED'
    : now - new Date(row.created_at).getTime() < 125 * 60 * 1000 ? 'PENDING_GRACE_PERIOD' : 'ORPHAN'
  const before = rows.map((row) => ({ path: row.name, status: classify(row), ageMinutes: Math.floor((now - new Date(row.created_at).getTime()) / 60000) }))
  if (exactPath && !rows.length) throw new Error('Path QA nao encontrado; nenhum objeto removido')
  let after = before
  if (execute) {
    const candidate = rows[0]
    if (rows.length !== 1 || classify(candidate) !== 'ORPHAN') throw new Error('Objeto ainda referenciado, em grace period ou nao encontrado')
    // Check again immediately before removal; DB RLS/policy remains the final guard.
    const second = (await db.query(`select exists(select 1 from public.documentos where url_arquivo=$1) as referenced`, [exactPath])).rows[0]
    if (second.referenced) throw new Error('Objeto passou a ser referenciado')
    const admin = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
    let removed = false
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const referenced = (await db.query(`select exists(select 1 from public.documentos where url_arquivo=$1) as referenced`, [exactPath])).rows[0].referenced
      if (referenced) throw new Error('Objeto passou a ser referenciado')
      const { error } = await admin.storage.from('documentos-cedentes').remove([exactPath])
      if (!error) {
        removed = (await db.query(`select 1 from storage.objects where bucket_id='documentos-cedentes' and name=$1`, [exactPath])).rowCount === 0
        if (removed) break
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
    if (!removed) throw new Error('Storage nao confirmou remocao QA apos tentativas limitadas')
    const stillThere = (await db.query(`select 1 from storage.objects where bucket_id='documentos-cedentes' and name=$1`, [exactPath])).rowCount > 0
    after = [{ path: exactPath, status: stillThere ? 'UNKNOWN' : 'REMOVED' }]
  }
  const counts = (items) => items.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), {})
  console.log(JSON.stringify({ projectRef: ref, mode: execute ? 'execute' : 'preview', scanned: rows.length,
    before: exactPath ? before : counts(before), after: exactPath ? after : counts(after) }))
} finally {
  await db.end()
}
