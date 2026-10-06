// Final local-only gate. Persists the exact tested migrations only in the
// disposable labelled database, then compares advisor/lint findings to baseline.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
assert.equal(process.argv.length,2)
const label=spawnSync('docker',['inspect','supabase_db_notificacoes-r1-20261005','--format','{{index .Config.Labels "com.supabase.cli.project"}}'],{encoding:'utf8',windowsHide:true})
assert.equal(label.status,0);assert.equal(label.stdout.trim(),'notificacoes-r1-20261005')
const url='postgresql://postgres:postgres@127.0.0.1:59422/postgres?sslmode=disable'
const cliArgs=['--db-url',url]
function cli(args){const r=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js',...args],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});assert.equal(r.status,0,'LOCAL_SQL_DIAGNOSTIC_COMMAND_FAILED');return JSON.parse(r.stdout)}
function scan(){return {security:cli(['db','advisors',...cliArgs,'--type','security','--level','warn','--fail-on','error','--output','json']),lint:cli(['db','lint',...cliArgs,'--schema','public,private','--level','error','--fail-on','none'])}}
const before=scan()
const db=new pg.Client({connectionString:url});await db.connect()
try{
  assert.equal(Number((await db.query('SELECT count(*) FROM auth.users')).rows[0].count),0)
  await db.query('BEGIN')
  for(const f of ['20261005213812_notificacoes_fund_scope.sql','20261006114841_notificacoes_shared_cedente_producers.sql','20261006124134_notificacoes_entity_producers.sql','20261006130657_notificacoes_scoped_ui.sql'])await db.query(readFileSync('supabase/migrations/'+f,'utf8'))
  await db.query('COMMIT')
  const after=scan()
  assert.deepEqual(after.security,before.security,'NEW_SECURITY_ADVISOR_FINDINGS')
  assert.deepEqual(after.lint,before.lint,'NEW_SQL_LINT_ERRORS')
  const report={target:'127.0.0.1:59422',success:true,before,after,productionQueried:false,homologQueried:false,cleanupRequired:true}
  writeFileSync('rehearsal/reports/NOTIFICACOES_LOCAL_ADVISORS.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({success:true,securityWarnings:after.security.length,preexistingSqlLint:after.lint.results?.map(r=>r.function),newFindings:0}))
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end()}
