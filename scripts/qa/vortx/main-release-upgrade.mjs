import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const hash = value => createHash('sha256').update(value.replaceAll('\r\n', '\n')).digest('hex')

/** Exact release upgrade only, on the native runner's new disposable database. */
export async function rehearseReleaseUpgrade(sql, phase) {
  const plan = JSON.parse(await readFile('docs/integracoes/vortx-production-rollout.json', 'utf8'))
  const manifest = JSON.parse(await readFile('scripts/qa/vortx/main-integration-manifest.json', 'utf8'))
  assert.deepEqual(plan.migrations, manifest.importedMigrations, 'RELEASE_MIGRATION_MANIFEST_MISMATCH')
  assert.equal(plan.migrations.length, 18, 'EXPLICIT_RELEASE_SET_REQUIRED')
  const entries = await Promise.all(plan.migrations.map(async entry => {
    assert.match(entry.path, /^supabase\/migrations\/202610\d{8}_[a-z_]+\.sql$/)
    const text = await readFile(entry.path, 'utf8')
    assert.equal(hash(text), entry.sha256, `RELEASE_MIGRATION_HASH_DRIFT:${entry.path}`)
    return { ...entry, text }
  }))
  // Effective grants, owners and RLS of every preexisting table stay identical.
  // Three preexisting provider-source functions are explicitly extended by the
  // reviewed native-stock migration. Only their bodies change; ACLs stay exact.
  const extensions = ['public.publicar_importacao_financeira(uuid,uuid)',
    'public.persistir_posicao_logistica_execucao(jsonb)', 'private.financeiro_fundo_virgem(uuid)']
  const signatures = extensions.map(value => `'${value}'::regprocedure`).join(',')
  const extendedQuery = `SELECT json_agg(json_build_object('signature',p.oid::regprocedure::text,'body',p.prosrc)
    ORDER BY array_position(ARRAY[${signatures}]::oid[],p.oid))
    FROM pg_proc p WHERE p.oid=ANY(ARRAY[${signatures}]::oid[]);`
  const extendedBefore = JSON.parse(await sql(extendedQuery))
  const existing = JSON.parse(await sql(`SELECT json_build_object(
    'tables',(SELECT array_agg(c.oid ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','private','auth','storage') AND c.relkind IN ('r','p')),
    'functions',(SELECT array_agg(p.oid ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','private','auth','storage')));`))
  const preserved = `SELECT md5(jsonb_build_object(
    'tables',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity,
      (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(coalesce(c.relacl,acldefault('r',c.relowner))) a)) ORDER BY c.oid)
      FROM pg_class c WHERE c.oid=ANY(ARRAY[${existing.tables.join(',')}]::oid[])),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polrelid,p.polname) FROM pg_policy p
      WHERE p.polrelid=ANY(ARRAY[${existing.tables.join(',')}]::oid[])),
    'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,
      CASE WHEN p.oid=ANY(ARRAY[${signatures}]::oid[]) THEN NULL ELSE p.prosrc END,
      p.prosecdef,p.proconfig,p.proowner,p.proacl) ORDER BY p.oid)
      FROM pg_proc p WHERE p.oid=ANY(ARRAY[${existing.functions.join(',')}]::oid[]))
    )::text);`
  const before = await sql(preserved)
  const evidence = []
  for (const entry of entries) {
    await phase(`RELEASE_UPGRADE_${entry.path.split('/').at(-1).slice(0, 14)}`)
    await sql(entry.text)
    evidence.push({ path: entry.path, sha256: entry.sha256, result: 'APPLIED_EXACT_BYTES_LOCAL_ONLY' })
  }
  assert.equal(await sql(preserved), before, 'PREEXISTING_FUNCTION_ACL_POLICY_OR_TABLE_SECURITY_CHANGED')
  const extendedAfter = JSON.parse(await sql(extendedQuery))
  const stockSql = entries.find(entry => entry.path.endsWith('_vortx_native_stock.sql')).text.replaceAll('\r\n', '\n')
  const providerExtensions = extendedAfter.map((item, index) => {
    const name = extensions[index].split('(')[0]
    const section = stockSql.slice(stockSql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`))
    const delimiter = /\bAS\s+(\$[a-z_0-9]*\$)/i.exec(section)
    assert(delimiter, 'REVIEWED_EXTENSION_BODY_MISSING')
    const begin = delimiter.index + delimiter[0].length, end = section.indexOf(delimiter[1], begin)
    assert.equal(item.body.replaceAll('\r\n', '\n'), section.slice(begin, end), 'PROVIDER_EXTENSION_DIFFERS_FROM_REVIEWED_MIGRATION')
    return { signature: item.signature, beforeSha256: hash(extendedBefore[index].body),
      afterSha256: hash(item.body), source: '20261019192624_vortx_native_stock.sql' }
  })
  assert.equal(await sql(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p') AND c.relname LIKE 'vortx_%' AND NOT c.relrowsecurity;`), '0', 'NEW_TABLE_WITHOUT_RLS')
  assert.equal(await sql(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('vortx_reservar_captura_callback','vortx_concluir_captura_callback','vortx_registrar_callback_rejeitado')
    AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE'));`), '0', 'RETIRED_CAPTURE_API_STILL_EXECUTABLE')
  return { result: 'PASS', migrationCount: evidence.length, migrations: evidence,
    preexistingSecurityHashBefore: before, preexistingSecurityHashAfter: await sql(preserved), providerExtensions,
    migrationHistoryWritten: false, fullHistoricalChainCertified: false, hostedCompatibilityCertified: false }
}
