// Build one explicit, hash-checked Preview migration payload; never connects or executes SQL.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { manifest, repository } from './preview-runtime.mjs'
const sha = value => createHash('sha256').update(value).digest('hex')
const version = '20261019211756', name = 'vortx_report_audit_event_types'
const path = `supabase/migrations/${version}_${name}.sql`, source = readFileSync(resolve(repository, path), 'utf8')
const entry = { version, name, path, sha256: sha(source) }
const base = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-callback-20261019')
const rehearsal = readdirSync(base).filter(p => p.startsWith('sql-')).sort().reverse()
  .map(p => ({ path: resolve(base, p, 'REPORT.json'), report: JSON.parse(readFileSync(resolve(base, p, 'REPORT.json'), 'utf8')) }))
  .find(({ report: r }) => !r.error && r.DOCKER_TEST_ENV_CLEANUP && r.stacks.length === 2 && r.stacks.every(s => s.checks.length >= 57)
    && r.migrations.some(m => m.path === path && m.sha256 === entry.sha256))
assert(rehearsal, 'EXACT_AUDIT_MIGRATION_NOT_CERTIFIED')
assert.equal(manifest.projectRef, 'phdckowbexkkvuwnzeaf')
assert(![manifest.productionRef, manifest.homologRef].includes(manifest.projectRef))
const baseline = JSON.parse(readFileSync(new URL('./__fixtures__/callback-audit-constraint.json', import.meta.url), 'utf8')).expression
const tables = ['public.seguranca_eventos', 'public.fundos', 'public.integracoes_fundo', 'public.integracao_fundo_versoes',
  'public.vortx_relatorio_solicitacoes', 'private.vortx_callback_endpoints', 'public.vortx_relatorio_eventos']
const rows = tables.map(t => `SELECT '${t}' kind,md5(coalesce(string_agg(row_to_json(r)::text,'|' order by id),'')) digest FROM ${t} r`).join(' UNION ALL ')
const catalog = `${rows} UNION ALL
 SELECT 'functions',md5(coalesce(string_agg(row_to_json(r)::text,'|' order by oid),'')) FROM
 (SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('auth','public','private') AND p.prokind IN ('f','p')) r UNION ALL
 SELECT 'table-security',md5(coalesce(string_agg(row_to_json(r)::text,'|' order by oid),'')) FROM
 (SELECT c.oid,c.relrowsecurity,c.relforcerowsecurity,c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p')) r UNION ALL
 SELECT 'policies',md5(coalesce(string_agg(row_to_json(r)::text,'|' order by oid),'')) FROM (SELECT * FROM pg_policy) r`
const literal = `$audit_source$${source}$audit_source$`
assert(!source.includes('$audit_source$'))
const query = `BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s';
LOCK TABLE public.seguranca_eventos IN ACCESS EXCLUSIVE MODE;
DO $preflight$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}')
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20261019180624','20261019201346','20261019203424'))<>3
 OR (SELECT pg_get_expr(conbin,conrelid) FROM pg_constraint WHERE conrelid='public.seguranca_eventos'::regclass AND conname='seguranca_eventos_tipo_check') IS DISTINCT FROM $old_expression$${baseline}$old_expression$
 THEN RAISE EXCEPTION 'AUDIT_MIGRATION_PREFLIGHT_FAILED'; END IF;
 IF encode(sha256(convert_to(${literal},'UTF8')),'hex')<>'${entry.sha256}' THEN RAISE EXCEPTION 'AUDIT_SOURCE_HASH_MISMATCH'; END IF;
END $preflight$;
CREATE TEMP TABLE callback_audit_before ON COMMIT DROP AS ${catalog};
${source.replace(/^BEGIN;\s*\r?\n/, '').replace(/\bCOMMIT;\s*$/, '')}
CREATE TEMP TABLE callback_audit_after ON COMMIT DROP AS ${catalog};
DO $preserve$ BEGIN
 IF EXISTS((SELECT * FROM callback_audit_before EXCEPT SELECT * FROM callback_audit_after) UNION ALL
 (SELECT * FROM callback_audit_after EXCEPT SELECT * FROM callback_audit_before)) THEN RAISE EXCEPTION 'AUDIT_PRESERVATION_FAILED'; END IF;
END $preserve$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[${literal}]);
COMMIT;`
const output = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence/vortx-callback-audit-fix-20261019')
mkdirSync(output, { recursive: true })
const payload = { project: manifest.projectRef, entry, rehearsal: rehearsal.path, query, querySha256: sha(query) }
writeFileSync(resolve(output, 'PAYLOAD.json'), JSON.stringify(payload, null, 2))
console.log(JSON.stringify({ path: resolve(output, 'PAYLOAD.json'), project: payload.project, entry, querySha256: payload.querySha256 }))
