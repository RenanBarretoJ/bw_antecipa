import path from 'node:path'
import {
  REPORT_DIR,
  ensureRuntimeDirectories,
  formatError,
  localPgConfig,
  withPgClient,
  writeJson,
} from './lib.mjs'
import { localSupabaseStatus, snapshotHash } from './runtime-lib.mjs'

async function collectSnapshot(client) {
  const result = await client.query(`
    select jsonb_build_object(
      'cedentes', (select count(*)::integer from public.cedentes),
      'operacoes', (select count(*)::integer from public.operacoes),
      'notas_fiscais', (select count(*)::integer from public.notas_fiscais),
      'documentos', (select count(*)::integer from public.documentos),
      'storage_objects', (select count(*)::integer from storage.objects),
      'profiles', (select count(*)::integer from public.profiles),
      'auth_users', (select count(*)::integer from auth.users),
      'fromtis_legado', (select count(*)::integer from public.operacoes where remessa_fromtis_id is not null or remessa_fromtis_retorno is not null),
      'operacao_ids', (select encode(extensions.digest(string_agg(id::text, ',' order by id::text), 'sha256'), 'hex') from public.operacoes),
      'nf_ids', (select encode(extensions.digest(string_agg(id::text, ',' order by id::text), 'sha256'), 'hex') from public.notas_fiscais),
      'documento_ids', (select encode(extensions.digest(string_agg(id::text, ',' order by id::text), 'sha256'), 'hex') from public.documentos),
      'storage_paths', (select encode(extensions.digest(string_agg(bucket_id || '/' || name, ',' order by bucket_id, name), 'sha256'), 'hex') from storage.objects)
    ) as snapshot
  `)
  return result.rows[0].snapshot
}

async function main() {
  ensureRuntimeDirectories()
  localSupabaseStatus()
  const result = await withPgClient(localPgConfig(), async (client) => {
    const before = await collectSnapshot(client)
    const normalized = await client.query(`
      update auth.users
         set confirmation_token = coalesce(confirmation_token, ''),
             recovery_token = coalesce(recovery_token, ''),
             email_change_token_new = coalesce(email_change_token_new, ''),
             email_change = coalesce(email_change, '')
       where confirmation_token is null
          or recovery_token is null
          or email_change_token_new is null
          or email_change is null
    `)
    const after = await collectSnapshot(client)
    return { before, after, auth_rows_normalized: normalized.rowCount }
  })
  const report = {
    generated_at: new Date().toISOString(),
    environment: 'rehearsal/local',
    purpose: 'PRE_RUNTIME',
    ...result,
    business_snapshot_unchanged: snapshotHash(result.before) === snapshotHash(result.after),
    snapshot_hash: snapshotHash(result.after),
  }
  writeJson(path.join(REPORT_DIR, 'PRE_RUNTIME.json'), report)
  if (!report.business_snapshot_unchanged) throw new Error('A compatibilizacao local de Auth alterou dados de negocio.')
  console.log('PRE_RUNTIME criado; destino local confirmado e tokens nulos de Auth compatibilizados.')
  console.log(`Linhas Auth normalizadas: ${report.auth_rows_normalized}`)
}

main().catch((error) => {
  console.error(`Preparacao do runtime falhou: ${formatError(error)}`)
  process.exitCode = 1
})

