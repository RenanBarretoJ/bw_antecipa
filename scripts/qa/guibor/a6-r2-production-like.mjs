// Local-only no-C5 verification. Remote production is never a target.
import assert from 'node:assert/strict'
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const container='supabase_db_bw-antecipa-prod-rehearsal'
const db='guibor_a6_r2_prodlike_20260929'
const migration='supabase/migrations/20260929215557_guibor_a6_decouple_c5.sql'
const source=readFileSync(migration,'utf8').replace(/\r\n/g,'\n').trimEnd()+'\n'
function sql(query) {
  const r=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-Atq'],
    {input:query,encoding:'utf8',windowsHide:true,maxBuffer:8000000})
  assert.equal(r.status,0,r.stderr)
  return r.stdout.trim()
}
function expand(file) {
  const text=readFileSync('supabase/tests/'+file,'utf8').replace(/^\\set.*$/mg,'')
  return text.replace(/^\\ir (.+)$/mg,(_,name)=>readFileSync('supabase/tests/'+name.trim(),'utf8'))
}
const noC5=JSON.parse(sql(`select jsonb_build_object('c5',to_regprocedure('private.consultor_usuario_pode_visualizar_cedente(uuid,uuid)'),
 'c5Fund',to_regprocedure('private.consultor_usuario_pode_visualizar_cedente_fundo(uuid,uuid,uuid)'),
 'c5History',(select count(*) from supabase_migrations.schema_migrations where name like 'c5%'),
 'users',(select count(*) from auth.users),'operations',(select count(*) from public.operacoes));`))
assert.deepEqual(noC5,{c5:null,c5Fund:null,c5History:0,users:0,operations:0})
const expectedCatalog=JSON.parse(readFileSync('rehearsal/tmp/a6-r2-production-catalog.json','utf8'))
const actualCatalog=JSON.parse(sql(readFileSync('scripts/qa/guibor/a6-r2-catalog.sql','utf8')))
const changedByGuibor=new Set([
  'public.aprovar_operacao_atomica_financeiro_v1',
  'public.dashboard_consultor_resumo','public.relatorio_consultor_analitico',
  'public.remover_nf_operacao_gestor_atomica','public.simular_memoria_financeira_operacao',
  'public.solicitar_operacao_antecipacao_atomica','public.solicitar_operacao_antecipacao_consultor_atomica',
])
// Restored PG deparser flattens nested AND groups in these two pre-existing CHECKs.
// Definitions were re-read from production and reapplied locally, not modified by R2.
const deparserOnly=new Set([
  'public.comunicacoes.comunicacoes_remetente_nome_check',
  'public.documento_upload_intents.documento_upload_intents_storage_path_check',
])
const mismatches=expectedCatalog.filter(o=>!actualCatalog.some(a=>a.kind===o.kind&&a.name===o.name&&a.hash===o.hash))
assert.deepEqual(mismatches.filter(o=>!(o.kind==='function'&&changedByGuibor.has(o.name.split('(')[0]))&&!(o.kind==='constraint'&&deparserOnly.has(o.name))),[],'BASELINE_SCHEMA_DRIFT_STOP')
const report={database:db,noC5,migration,hash:createHash('sha256').update(source).digest('hex'),catalog:{sourceObjects:expectedCatalog.length,finalObjects:actualCatalog.length,expectedChanges:mismatches},tests:{},success:false}
for(const file of ['guibor_a5_base.test.sql','guibor_a6_comissao.test.sql','guibor_a6_r2_analytics_scope.test.sql','c1_1_organizacao_consultora.test.sql','c2_1_r2_fluxo_taxa.test.sql']) {
  const output=sql(expand(file))
  assert(!/^not ok|Looks like you failed|Looks like you planned/m.test(output),output)
  const lines=output.split('\n').filter(l=>/^(ok |not ok |1\.\.)/.test(l))
  report.tests[file]=lines
  console.log(file+': '+lines.filter(l=>l.startsWith('ok ')).length+' PASS')
}
// Reapplying the corrective DDL must preserve an already-enabled flag and all rows.
const fixture=readFileSync('supabase/tests/fixtures/guibor_a5_a6.sql','utf8')
const probe=sql(`BEGIN; SELECT no_plan(); ${fixture}
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"aal":"aal2","role":"authenticated"}',true);
SELECT public.configurar_comissao_consultor_fundo('29000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',true);
SELECT set_config('qa.flags_before',(select md5(jsonb_agg(to_jsonb(cf) order by id)::text) from public.consultor_fundos cf),true);
${source.replace(/\bBEGIN;/,'').replace(/COMMIT;\s*$/,'')}
SELECT is((select md5(jsonb_agg(to_jsonb(cf) order by id)::text) from public.consultor_fundos cf),current_setting('qa.flags_before'),'corrective DDL preserves ON flag and all existing link fields');
SELECT * FROM finish(); ROLLBACK;`)
assert(!/^not ok/m.test(probe),probe)
report.idempotentOnPreserved=true
assert.equal(sql('select count(*) from auth.users'), '0')
assert.equal(sql('select count(*) from public.operacoes'), '0')
report.success=true
mkdirSync('rehearsal/reports',{recursive:true})
writeFileSync('rehearsal/reports/GUIBOR_A6_R2_PRODUCTION_LIKE.json',JSON.stringify(report,null,2))
console.log('PRODUCTION_LIKE_NO_C5_PASS')
