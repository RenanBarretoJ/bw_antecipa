// Produces an explicit, reviewed SQL payload. Execution is through the authenticated Supabase connector.
// No database password, API secret, TLS exception, automatic replay or history repair.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { manifest, repository } from './preview-runtime.mjs'
const sha = value => createHash('sha256').update(value).digest('hex')
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-callback-ui-20261019', 'migration-payload')
mkdirSync(output, { recursive: true })
const entries = [{ version: '20261019201346', name: 'vortx_report_callback_inbox' }, { version: '20261019203424', name: 'vortx_callback_admin_ui' }]
  .map(e => { const path = `supabase/migrations/${e.version}_${e.name}.sql`, sql = readFileSync(resolve(repository, path), 'utf8'); return { ...e, path, sql, sha256: sha(sql) } })
const sqlBase = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-callback-20261019')
const certified = readdirSync(sqlBase).filter(p => p.startsWith('sql-')).sort().reverse().map(p => JSON.parse(readFileSync(resolve(sqlBase, p, 'REPORT.json'), 'utf8')))
  .find(r => !r.error && r.DOCKER_TEST_ENV_CLEANUP && entries.every(e => r.migrations.some(m => m.path === e.path && m.sha256 === e.sha256)))
assert(certified && certified.stacks.length === 2 && certified.stacks.every(s => s.checks.length >= 55), 'EXACT_MIGRATIONS_NOT_CERTIFIED')
assert.equal(manifest.projectRef, 'phdckowbexkkvuwnzeaf'); assert(![manifest.productionRef, manifest.homologRef].includes(manifest.projectRef))
const fingerprints = ['fundos', 'integracoes_fundo', 'integracao_fundo_versoes', 'vortx_relatorio_solicitacoes'].map(table => `select '${table}' tabela,count(*)::bigint n,md5(coalesce(string_agg(row_to_json(t)::text,'|' order by id),'')) digest from public.${table} t`).join(' UNION ALL ')
let query = `BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s';
DO $gate$ BEGIN
 IF EXISTS(select 1 from supabase_migrations.schema_migrations where version IN ('20260929193129','20261019192624','20261019201346','20261019203424'))
  OR to_regclass('private.vortx_callback_endpoints') IS NOT NULL
  OR to_regclass('public.vortx_relatorio_solicitacoes') IS NULL THEN
  RAISE EXCEPTION 'PREVIEW_CALLBACK_PREFLIGHT_FAILED';
 END IF;
END $gate$;
CREATE TEMP TABLE callback_business_before ON COMMIT DROP AS ${fingerprints};\n`
for (const e of entries) {
  const delimiter = `$source_${e.sha256.slice(0, 16)}$`
  assert(!e.sql.includes(delimiter))
  const literal = `${delimiter}${e.sql}${delimiter}`
  query += `DO $hashcheck$ BEGIN IF encode(sha256(convert_to(${literal},'UTF8')),'hex')<>'${e.sha256}' THEN RAISE EXCEPTION 'MIGRATION_HASH_MISMATCH'; END IF; END $hashcheck$;\n`
  query += e.sql.replace(/(^|\n)BEGIN;\s*\r?\n/, '$1').replace(/\bCOMMIT;\s*$/, '')
  // Insert genuine history only after executing these exact source bytes, in the same transaction.
  query += `\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${e.version}','${e.name}',ARRAY[${literal}]);\n`
}
query += `CREATE TEMP TABLE callback_business_after ON COMMIT DROP AS ${fingerprints};
DO $preserve$ BEGIN
 IF EXISTS((select * from callback_business_before EXCEPT select * from callback_business_after) UNION ALL (select * from callback_business_after EXCEPT select * from callback_business_before))
 THEN RAISE EXCEPTION 'BUSINESS_DATA_CHANGED'; END IF;
END $preserve$;
NOTIFY pgrst,'reload schema'; COMMIT;`
const payload = { project: manifest.projectRef, entries: entries.map(e => ({ version: e.version, name: e.name, path: e.path, sha256: e.sha256 })), query, querySha256: sha(query) }
writeFileSync(resolve(output, 'PAYLOAD.json'), JSON.stringify(payload, null, 2))
console.log(JSON.stringify({ path: resolve(output, 'PAYLOAD.json'), project: payload.project, entries: payload.entries, querySha256: payload.querySha256 }))
