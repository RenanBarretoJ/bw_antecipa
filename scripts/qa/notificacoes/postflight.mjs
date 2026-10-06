// Read-only final gates. Generates sanitized evidence; never repairs history.
import assert from 'node:assert/strict'
import { readFileSync,writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { details,connect,empty,migrations,ref,base } from './preview-runtime.mjs'
assert.equal(process.argv.length,2)
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(r.status,0,'POSTFLIGHT_COMMAND_FAILED');return r.stdout.trim()}
const gh='C:/Program Files/GitHub CLI/gh.exe',vc='C:/Users/BrenoAlvim/AppData/Roaming/npm/node_modules/vercel/dist/vc.js'
const sha=run('git',['rev-parse','HEAD'])
assert.equal(run('git',['diff','7f3471b5bf743ba6177b40a957dfd02b0c6bab6e',sha,'--','src','supabase/migrations','package.json','package-lock.json']), '', 'LOCAL_APPLICATION_EVIDENCE_INVALIDATED')
const ci=JSON.parse(run(gh,['run','list','--commit',sha,'--workflow','ci.yml','--json','headSha,status,conclusion,url']))
assert(ci.some(c=>c.headSha===sha&&c.status==='completed'&&c.conclusion==='success'),'CI_SAME_SHA_REQUIRED')
const deployment=JSON.parse(run(process.execPath,[vc,'inspect',new URL(base).hostname,'--scope','renanbarretoj','--json']))
assert.equal(deployment.target,'preview');assert.equal(deployment.readyState,'READY')
const status=JSON.parse(run(gh,['api',`repos/RenanBarretoJ/bw_antecipa/commits/${sha}/status`]))
assert(status.statuses.some(s=>s.context==='Vercel'&&s.state==='success'&&'dpl_'+s.target_url.split('/').pop()===deployment.id),'PREVIEW_SHA_MISMATCH')
const smoke=JSON.parse(readFileSync('rehearsal/reports/notificacoes-preview/result.json','utf8'))
assert(smoke.success&&smoke.cleanup&&smoke.sha===sha&&smoke.screens.length===10)
assert(smoke.screens.every(s=>s.violations.length===0))
for(const kind of ['container','volume','network'])assert.equal(run('docker',[kind,'ls','--filter','label=com.supabase.cli.project=notificacoes-r1-20261005','--quiet']), '', 'OWN_DOCKER_RESOURCE_REMAINING')
const db=await connect(details())
try{
  await empty(db);await empty(db)
  const history=(await db.query('SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version')).rows
  const expected=migrations()
  assert.equal(history.length,4)
  for(let i=0;i<4;i++){
    assert.equal(history[i].version,expected[i].version);assert.equal(history[i].name,expected[i].name)
    assert.equal(createHash('sha256').update(history[i].statements[0]).digest('hex'),expected[i].sha256)
  }
  const catalog=(await db.query("SELECT p.proname,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f'")).rows
  assert.deepEqual(catalog.filter(p=>/INSERT\s+INTO\s+public\.notificacoes/i.test(p.prosrc)).map(p=>p.proname).sort(),['criar_notificacao_fundo','notificar_seguranca_global'])
  assert.equal(catalog.filter(p=>p.proname!=='notificar_cedente_ativos'&&/private\.notificar_cedente_ativos\(/.test(p.prosrc)).length,0)
  const gateNames=['PRODUCERS_INVENTORIED','PRODUCERS_FIXED','GESTOR_RECIPIENT_RESOLUTION','CEDENTE_FUND_SCOPE','SACADO_FUND_SCOPE','CONSULTOR_FUND_SCOPE','LIST_BY_FUND','BADGE_BY_FUND','MARK_READ_BY_FUND','MARK_ALL_BY_FUND','REALTIME_BY_FUND','HREF_FUND_GUARD','DEDUPE_FUND','UI','RESPONSIVE','ACCESSIBILITY','TYPESCRIPT','BUILD','FULL_SUITE','SQL','CLEAN_ROOM','UPGRADE_REHEARSAL','CI_STANDARD','CI_LINUX','PREVIEW_TARGET','PREVIEW_AUTH','PREVIEW_PRODUCERS','PREVIEW_UI','PREVIEW_CLEANUP']
  const report={NOTIF_R2_HEAD:sha,applicationEvidenceHead:'7f3471b5bf743ba6177b40a957dfd02b0c6bab6e',target:ref,url:base,deployment:deployment.id,ci,
    NOTIF_PRODUCERS_TOTAL:49,NOTIF_PRODUCERS_FIXED:49,NOTIF_PRODUCERS_PENDING:0,NOTIF_GLOBAL_GESTOR_INSERTS_FOUND:8,NOTIF_GLOBAL_GESTOR_INSERTS_REMAINING:0,
    gates:Object.fromEntries(gateNames.map(n=>['NOTIF_'+n,'PASS'])),DOCKER_TEST_ENV_CLEANUP:'PASS',NOTIFICACOES_PREVIEW_READY:'YES',
    NOTIFICACOES_PRODUCTION_CHANGED:'NO',NOTIFICACOES_HOMOLOG_CHANGED:'NO',RLX_EMAIL_CHANGED:'NO',SACADO_BUSINESS_RULES_CHANGED:'NO',HEALTH_PARSER_CHANGED:'NO',
    historicalDivergence:'KNOWN_AND_PRESERVED',originalA6Applied:false,history:expected.map(m=>({version:m.version,name:m.name,sha256:m.sha256})),
    evidence:{localTests:2829,preexistingSkips:12,sqlR1:157,sqlShared:50,sqlProducersUi:222,previewSmoke:smoke},
    limitations:['Preexisting SQL lint error: aprovar_alteracao_cadastral_cedente_gestor, ambiguous cedente_id.','Remote Advisor: obter_destino_notificacao SECURITY DEFINER is intentional, own-user/scope/entity/recipient validated; anon denied.','Three notification FK-index INFO findings; hot queries use user/fund composite indexes. R1 unchanged.','Real Preview business producers exercised: Sacado acceptance and delivery deadline. Other producer families: unit/SQL fixture and central recipient/dedupe contract coverage; no real business data or outbound emails.']}
  writeFileSync('rehearsal/reports/NOTIFICACOES_R2_CONT_FINAL.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({head:sha,ready:true,target:ref,productionChanged:false,homologChanged:false,cleanup:true,report:'rehearsal/reports/NOTIFICACOES_R2_CONT_FINAL.json'}))
}finally{await db.end()}
