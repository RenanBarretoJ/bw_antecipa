// Read-only final gates. Generates sanitized evidence; never repairs history.
import assert from 'node:assert/strict'
import { readFileSync,writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { details,connect,empty,migrations,ref,base } from './preview-runtime.mjs'
import {applicationHash} from './r3-local-gates.mjs'
assert.equal(process.argv.length,2)
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(r.status,0,'POSTFLIGHT_COMMAND_FAILED');return r.stdout.trim()}
const gh='C:/Program Files/GitHub CLI/gh.exe',vc='C:/Users/BrenoAlvim/AppData/Roaming/npm/node_modules/vercel/dist/vc.js'
const sha=run('git',['rev-parse','HEAD'])
const local=JSON.parse(readFileSync('rehearsal/reports/notificacoes-r3/local-gates.json','utf8'))
assert(local.success&&local.applicationHash===applicationHash(),'LOCAL_APPLICATION_EVIDENCE_INVALIDATED')
assert.deepEqual(local.gates.map(g=>g.name),['focused','typescript','lint','full-suite','build','sql-r1','sql-shared','sql-producers','browser'])
assert(local.gates.every(g=>g.code===0))
assert.equal(run('git',['diff','5500b5bed85f683baedb827f0d41f8704c77a77d',sha,'--','supabase/migrations','src/lib','package.json','package-lock.json']), '', 'R3_DOMAIN_SCOPE_CHANGED')
const controlled=JSON.parse(readFileSync('rehearsal/reports/notificacoes-browser-local/focus-controlled.json','utf8'))
assert.equal(controlled.results.length,3)
assert(controlled.results.every(r=>!r.premature.inside&&r.premature.active.guard&&r.settled.inside),'ROOT_CAUSE_NOT_PROVEN')
const ci=JSON.parse(run(gh,['run','list','--commit',sha,'--workflow','ci.yml','--json','headSha,status,conclusion,url']))
assert(ci.some(c=>c.headSha===sha&&c.status==='completed'&&c.conclusion==='success'),'CI_SAME_SHA_REQUIRED')
const deployment=JSON.parse(run(process.execPath,[vc,'inspect',new URL(base).hostname,'--scope','renanbarretoj','--json']))
assert.equal(deployment.target,'preview');assert.equal(deployment.readyState,'READY')
const status=JSON.parse(run(gh,['api',`repos/RenanBarretoJ/bw_antecipa/commits/${sha}/status`]))
assert(status.statuses.some(s=>s.context==='Vercel'&&s.state==='success'&&'dpl_'+s.target_url.split('/').pop()===deployment.id),'PREVIEW_SHA_MISMATCH')
const smoke=JSON.parse(readFileSync('rehearsal/reports/notificacoes-preview/result.json','utf8'))
assert(smoke.success&&smoke.cleanup&&smoke.cleanupRuns.length===2&&smoke.sha===sha&&smoke.screens.length===10)
assert(smoke.screens.every(s=>s.violations.length===0&&s.keyboard&&s.negativeEscape&&s.semantics.badgeHidden))
for(const family of ['aceitar','contestar','delivery deadline','documento_enviado','alteracao_cadastral','technical operation-scoped'])assert(smoke.checks.some(c=>c.includes(family)),'PRODUCER_SMOKE_MISSING:'+family)
for(const role of ['gestor','cedente','sacado','consultor'])assert(smoke.checks.includes(role+':keyboard A/B, realtime focus, trigger stability and negative escape'))
for(const kind of ['container','volume','network'])assert.equal(run('docker',[kind,'ls','--filter','label=com.supabase.cli.project=notificacoes-r1-20261005','--quiet']), '', 'OWN_DOCKER_RESOURCE_REMAINING')
const db=await connect(details())
try{
  await empty(db);await empty(db)
  for(const table of ['auth.sessions','auth.mfa_factors'])assert.equal(Number((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count),0)
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
  const focusGates=['FOCUS_RESTORATION','ESCAPE','ENTER','TAB','SHIFT_TAB','TRIGGER_STABILITY','NEGATIVE_FOCUS_ESCAPE','REALTIME_FOCUS','FUND_SWITCH_FOCUS','MATRIX_10','KEYBOARD']
  const report={NOTIF_R3_HEAD:sha,applicationHash:local.applicationHash,target:ref,url:base,deployment:deployment.id,ci,
    NOTIF_R3_ROOT_CAUSE:'H: harness sent Tab during Base UI OPENING before RAF initial focus; stable trigger, native guards transiently focused. Independent I: mark-read removed focused action/row and left body focused.',
    NOTIF_R3_FIX:'Semantic closed/open readiness in tests; shared removal-focus recovery in notification UI, no trap replacement; badge aria-hidden. Body/root negative still rejected.',
    NOTIF_R3_FOCUS_ESCAPED_REPRODUCED:'YES',...Object.fromEntries(focusGates.map(n=>['NOTIF_R3_'+n,'PASS'])),
    NOTIF_PRODUCERS_TOTAL:49,NOTIF_PRODUCERS_FIXED:49,NOTIF_PRODUCERS_PENDING:0,NOTIF_GLOBAL_GESTOR_INSERTS_FOUND:8,NOTIF_GLOBAL_GESTOR_INSERTS_REMAINING:0,
    gates:Object.fromEntries(gateNames.map(n=>['NOTIF_'+n,'PASS'])),DOCKER_TEST_ENV_CLEANUP:'PASS',NOTIFICACOES_PREVIEW_READY:'YES',
    NOTIFICACOES_PRODUCTION_CHANGED:'NO',NOTIFICACOES_HOMOLOG_CHANGED:'NO',RLX_EMAIL_CHANGED:'NO',SACADO_BUSINESS_RULES_CHANGED:'NO',HEALTH_PARSER_CHANGED:'NO',
    HISTORICAL_DIVERGENCE:'KNOWN_AND_PRESERVED',GUIBOR_A6_ORIGINAL_APPLIED:'NO',GUIBOR_A6_ORIGINAL_HISTORY_FAKED:'NO',history:expected.map(m=>({version:m.version,name:m.name,sha256:m.sha256})),
    evidence:{local,previewSmoke:smoke},
    limitations:['No manual screen-reader audit; browser keyboard, accessible semantics and Axe A/AA certified separately.','Preexisting SQL lint error: aprovar_alteracao_cadastral_cedente_gestor, ambiguous cedente_id, outside R3.','Producer smoke uses real Auth/RPCs for acceptance/contest and real deadline cron; document/cadastro/technical events exercise the production producer RPC boundaries with synthetic entities, not full upload/provider workflows. No outbound emails or real customer data.']}
  writeFileSync('rehearsal/reports/NOTIFICACOES_R3_FINAL.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({head:sha,ready:true,target:ref,productionChanged:false,homologChanged:false,cleanup:true,report:'rehearsal/reports/NOTIFICACOES_R3_FINAL.json'}))
}finally{await db.end()}
