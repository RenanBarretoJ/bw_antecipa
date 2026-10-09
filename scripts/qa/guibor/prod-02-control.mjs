// Explicit GUIBOR production allowlist. No db push, no original A6, no QA in production.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { normalizeSql, sqlLiteral } from './history-envelope.mjs'

export const ref = 'wwsndnuvnjuabpbjwlck'
export const container = 'supabase_db_bw-antecipa-prod-rehearsal'
export const db = 'guibor_prod02_certified_20260930'
const root = 'rehearsal/reports/GUIBOR_PROD_02'
mkdirSync('rehearsal/tmp', { recursive: true })
mkdirSync('rehearsal/reports', { recursive: true })
const exact = [
  ['20260929154656_guibor_nfse_fiscal_provenance.sql', '6764965cb3be144ff3604f7aa294aafc62e90270a72d2a4d7104689571e31d76'],
  ['20260929174520_guibor_nfse_review_intents.sql', '740cc2ac6f70cb2341f06853496c0394229fa0f0849518f9357204e286ba4f39'],
  ['20260929191004_guibor_a5_base_antecipacao.sql', 'b0ee16a0179012da540956d9df4fb6f456dbf81c85015ea681ff52959148f940'],
  ['20260929215557_guibor_a6_decouple_c5.sql', '8c05f9c58df7bff55959c972c64268191ea010cad15a9df2bafbf18d12191d85'],
]
export const migrations = exact.map(([file, hash]) => {
  const source = normalizeSql(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  assert.equal(createHash('sha256').update(source).digest('hex'), hash, 'CERTIFIED_HASH_DRIFT_STOP')
  return { file, version: file.slice(0,14), name: file.slice(15,-4), hash, source }
})
const versions = migrations.map(m => `'${m.version}'`).join(',')
export function run(command, args, input) {
  const r = spawnSync(command, args, { input, encoding:'utf8', windowsHide:true, timeout:120000, maxBuffer:30000000 })
  if (r.status !== 0) {
    writeFileSync(`${root}_LAST_ERROR.txt`, r.stderr || r.stdout || 'Command failed')
    throw new Error('COMMAND_FAILED_SEE_IGNORED_REPORT')
  }
  return r.stdout
}
export function remote(query) {
  assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(), ref, 'WRONG_TARGET_STOP')
  writeFileSync('rehearsal/tmp/guibor-prod02-query.sql', query)
  return JSON.parse(run(process.execPath, ['node_modules/supabase/dist/supabase.js','db','query','--linked','--file','rehearsal/tmp/guibor-prod02-query.sql','--output','json'])).rows
}
export function local(query, database=db) {
  assert([db,'postgres'].includes(database))
  return run('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-Atq'],query).trim()
}
export const historySql = `select version,name,encode(extensions.digest(replace(array_to_string(statements,E'\\n'),chr(13),''),'sha256'),'hex') hash from supabase_migrations.schema_migrations order by version`
export const noC5Sql = `select jsonb_build_object('helper',to_regprocedure('private.consultor_usuario_pode_visualizar_cedente(uuid,uuid)'),
  'history',(select count(*) from supabase_migrations.schema_migrations where name ~* '^c5_'),
  'oldA6',(select count(*) from supabase_migrations.schema_migrations where version='20260929193129')) value`
const excluded = {
  notas_fiscais:['tipo_documento_fiscal','valor_liquido_origem','vencimento_origem','fiscal_proveniencia'],
  operacoes:['base_antecipacao_snapshot'], cedente_fundos:['base_valor_antecipacao'], consultor_fundos:['comissao_habilitada'],
}
export const tables = ['notas_fiscais','operacoes','cedente_fundos','consultor_fundos','operacoes_nfs','nota_fiscal_parcelas',
  'operacao_calculo_nfs','eventos_dominio','logs_auditoria','politicas_operacionais','politica_operacional_versoes',
  'cedente_fundo_politicas','cedente_estabelecimentos','taxas_cedente','documentos_repositorio','documento_versoes']
export const fingerprintSql = `select jsonb_build_object(${[...tables.map(table => {
  const expr = `to_jsonb(t)${excluded[table] ? `-array[${excluded[table].map(s=>`'${s}'`).join(',')}]::text[]` : ''}`
  return `'${table}',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg((${expr})::text,'' order by (${expr})::text),''))) from public.${table} t)`
}),`'storage',(select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),''))) from storage.objects t)`,
`'history',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by version),'')) from supabase_migrations.schema_migrations t where version not in (${versions}))`,
`'rls',(select md5(string_agg(row(schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check)::text,'' order by schemaname,tablename,policyname)) from pg_policies where schemaname in ('public','private','storage'))`].join(',')}) value`
export function envelope(ms) {
  return ms.map(m => `${m.source.replace(/^\s*(?:BEGIN|begin);\s*$/m,'').replace(/^\s*(?:COMMIT|commit);\s*$/m,'')}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${m.version}','${m.name}',ARRAY[${sqlLiteral(m.source)}]);`).join('\n')
}
export function save(name, value) { writeFileSync(`${root}_${name}.json`, JSON.stringify(value,null,2)) }
function preflight() {
  const noC5=remote(noC5Sql)[0].value
  assert.deepEqual(noC5,{helper:null,history:0,oldA6:0})
  const history=remote(historySql)
  for(const v of ['20260929141740','20260928193000','20260928185439','20260928183000','20260928120000','20260925144547']) assert(history.some(m=>m.version===v),'BASELINE_MISSING')
  for(const row of history.filter(r=>r.name?.startsWith('guibor'))) assert(migrations.some(m=>m.version===row.version&&m.hash===row.hash),'UNEXPECTED_GUIBOR_HISTORY')
  const catalog=remote(readFileSync('scripts/qa/guibor/a6-r2-catalog.sql','utf8'))[0].objects
  const repairs=remote(`select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='corrigir_duplicata'`)
  const policies=remote(`select * from pg_policies where schemaname='storage' order by tablename,policyname`)
  const before=remote(fingerprintSql)[0].value
  const result={target:ref,at:new Date().toISOString(),noC5,history,catalog,repairs,policies,before,migrations:migrations.map(({file,version,name,hash})=>({file,version,name,hash}))}
  save('PREFLIGHT',result)
  console.log(JSON.stringify({target:ref,noC5,history:history.length,catalog:catalog.length,hashes:result.migrations}))
}
if(process.argv[1]?.replace(/\\/g,'/').endsWith('/prod-02-control.mjs')) {
  assert.equal(process.argv[2],'--preflight','ONLY_READ_ONLY_PREFLIGHT_IMPLEMENTED')
  preflight()
}
