#!/usr/bin/env node
// P9.3: manual, exact-ID, read-only by default. Never schedule in production.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { classificarIntentParaCleanup } from './p9-3-intent-decision.mjs'

for (const line of readFileSync('.env.homolog', 'utf8').split(/\r?\n/)) {
  const split = line.indexOf('=')
  if (split < 1 || line.trimStart().startsWith('#')) continue
  const key = line.slice(0, split).trim()
  let value = line.slice(split + 1).trim()
  if (/^['"]/.test(value) && value[0] === value.at(-1)) value = value.slice(1, -1)
  if (!(key in process.env)) process.env[key] = value
}
const required = (name) => {
  if (!process.env[name]) throw new Error(`${name} ausente`)
  return process.env[name]
}
const ref = new URL(required('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
if (ref !== 'fhgkmggthxikfpogrvaa' || ref === required('SUPABASE_PRODUCTION_PROJECT_REF')) throw new Error('Destino nao e homolog')
const args = process.argv.slice(2)
const intentId = args.includes('--intent-id') ? args[args.indexOf('--intent-id') + 1] : null
const execute = args.includes('--execute')
const confirm = args.includes('--confirm') ? args[args.indexOf('--confirm') + 1] : null
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
if (intentId && !uuid.test(intentId)) throw new Error('--intent-id exige UUID exato')
if (execute && (!intentId || confirm !== `LIMPAR_INTENT_HOMOLOG_${ref}`)) throw new Error('Cleanup exige --intent-id e confirmacao exata')

const url = new URL(required('SUPABASE_DB_URL'))
if (!url.hostname.includes(ref) && !decodeURIComponent(url.username).includes(ref)) throw new Error('Database URL nao pertence ao projeto homolog')
url.password = required('SUPABASE_PASSWORD')
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 })
await db.connect()
try {
  const query = `select i.id, i.cedente_id, i.usuario_id, i.tipo_documento, i.representante_id,
      i.storage_bucket, i.storage_path, i.status, i.cleanup_after, i.created_at,
      i.documento_versao_id, i.attempt_count, i.updated_at, c.cnpj,
      (exists(select 1 from public.documentos d where d.url_arquivo=i.storage_path)
        or exists(select 1 from public.documento_versoes v where v.path=i.storage_path)
        or exists(select 1 from public.documentos_gerados g where g.storage_path=i.storage_path)) as referenced,
      exists(select 1 from storage.objects o where o.bucket_id=i.storage_bucket and o.name=i.storage_path) as object_present,
      (select o.owner_id from storage.objects o where o.bucket_id=i.storage_bucket and o.name=i.storage_path) as storage_owner_id
    from public.documento_upload_intents i join public.cedentes c on c.id=i.cedente_id
    where ($1::uuid is null or i.id=$1)
      and ($1::uuid is not null or i.status in ('PREPARED','UPLOADED','FAILED','EXPIRED','CLEANUP_PENDING'))
    order by i.cleanup_after asc limit 200`
  const rows = (await db.query(query, [intentId])).rows
  const classify = (row) => classificarIntentParaCleanup(row)
  const describe = (row) => ({ intentId: row.id, status: row.status,
    ageMinutes: Math.floor((Date.now() - Date.parse(row.created_at)) / 60000),
    objectPresent: row.object_present, ownerVerified: row.object_present && row.storage_owner_id === row.usuario_id,
    documentReferenced: row.referenced,
    cleanupEligible: classify(row) === 'ELIGIBLE', decision: classify(row) })
  const before = rows.map(describe)
  if (execute && rows.length === 1 && classify(rows[0]) === 'CLEANED') {
    console.log(JSON.stringify({ projectRef: ref, mode: 'execute', skipped: 'ALREADY_CLEANED', before: before[0], after: before[0] }))
  } else if (execute) {
    if (rows.length !== 1 || classify(rows[0]) !== 'ELIGIBLE') throw new Error('Intent nao elegivel; nenhuma exclusao')
    const candidate = rows[0]
    await db.query('BEGIN')
    try {
      const claim = await db.query(`update public.documento_upload_intents i
        set status='CLEANUP_PENDING', attempt_count=attempt_count+1, updated_at=now()
        where i.id=$1 and i.status in ('PREPARED','UPLOADED','FAILED','EXPIRED','CLEANUP_PENDING')
          and i.cleanup_after<=now() and i.documento_versao_id is null and i.attempt_count<3
          and (i.status <> 'CLEANUP_PENDING' or i.updated_at <= now() - i.attempt_count * interval '1 minute')
          and not exists(select 1 from public.documentos d where d.url_arquivo=i.storage_path)
          and not exists(select 1 from public.documento_versoes v where v.path=i.storage_path)
          and not exists(select 1 from public.documentos_gerados g where g.storage_path=i.storage_path)
          and exists(select 1 from storage.objects o where o.bucket_id=i.storage_bucket
            and o.name=i.storage_path and o.owner_id=i.usuario_id::text)
        returning i.id`, [intentId])
      if (claim.rowCount !== 1) throw new Error('Claim concorrente ou referencia detectada')
      await db.query('COMMIT')
    } catch (error) { await db.query('ROLLBACK'); throw error }

    // A trigger blocks every new canonical document row while claimed.
    let recheck
    try {
      recheck = (await db.query(query, [intentId])).rows[0]
      if (!recheck || recheck.storage_path !== candidate.storage_path || recheck.referenced ||
        !recheck.object_present || recheck.storage_owner_id !== recheck.usuario_id ||
        recheck.documento_versao_id || recheck.status !== 'CLEANUP_PENDING') {
        throw new Error('Estado inconclusivo apos claim; objeto preservado')
      }
      const admin = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'),
        { auth: { persistSession: false, autoRefreshToken: false } })
      if (recheck.object_present) {
        const { data: info, error: infoError } = await admin.storage.from(candidate.storage_bucket).info(candidate.storage_path)
        if (infoError || !info) throw new Error('Storage inconclusivo; objeto preservado')
        const { error: removeError } = await admin.storage.from(candidate.storage_bucket).remove([candidate.storage_path])
        if (removeError) throw new Error('Storage nao confirmou remocao')
      }
      await db.query('BEGIN')
      const final = await db.query(`update public.documento_upload_intents i
        set status='CLEANED', cleaned_at=now(), updated_at=now(), last_error_code=null
        where i.id=$1 and i.status='CLEANUP_PENDING' and i.documento_versao_id is null
          and not exists(select 1 from public.documentos d where d.url_arquivo=i.storage_path)
          and not exists(select 1 from public.documento_versoes v where v.path=i.storage_path)
          and not exists(select 1 from public.documentos_gerados g where g.storage_path=i.storage_path)
          and not exists(select 1 from storage.objects o where o.bucket_id=i.storage_bucket and o.name=i.storage_path)
        returning i.id`, [intentId])
      if (final.rowCount !== 1) throw new Error('Verificacao final inconclusiva; revisar intent manualmente')
      await db.query(`insert into public.logs_auditoria
        (tipo_evento, entidade_tipo, entidade_id, ator_tipo, ator_identificador, origem, dados_depois)
        values ('DOCUMENTO_UPLOAD_INTENT_CLEANED','documento_upload_intents',$1,'sistema',
          'p9-3-upload-intents-reconciler','homologacao',jsonb_build_object('objeto_removido',$2::boolean))`,
        [intentId, recheck.object_present])
      await db.query('COMMIT')
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {})
      await db.query(`update public.documento_upload_intents
        set last_error_code='CLEANUP_UNCONFIRMED', updated_at=now()
        where id=$1 and status='CLEANUP_PENDING'`, [intentId])
      throw error
    }
    console.log(JSON.stringify({ projectRef: ref, mode: 'execute', before: before[0], after: describe((await db.query(query, [intentId])).rows[0]) }))
  } else {
    console.log(JSON.stringify({ projectRef: ref, mode: 'read-only', scanned: rows.length, before }))
  }
} finally {
  await db.end()
}
