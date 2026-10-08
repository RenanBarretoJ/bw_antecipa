import assert from 'node:assert/strict'
import { readFileSync,writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { details,connect,empty,migrations,ref } from './preview-runtime.mjs'
assert.deepEqual(process.argv.slice(2),['--apply'])
const sha=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).stdout.trim()
const ci=spawnSync('C:/Program Files/GitHub CLI/gh.exe',['run','list','--commit',sha,'--workflow','ci.yml','--json','headSha,conclusion,status'],{encoding:'utf8',windowsHide:true,timeout:30000})
assert.equal(ci.status,0,'CI_LOOKUP_FAILED')
assert(JSON.parse(ci.stdout).some(r=>r.headSha===sha&&r.conclusion==='success'&&r.status==='completed'),'SAME_SHA_CI_PASS_REQUIRED')
assert(JSON.parse(readFileSync('rehearsal/reports/NOTIFICACOES_LOCAL_ADVISORS.json','utf8')).success)
const list=migrations(), db=await connect(details())
try{
  await empty(db)
  assert.equal(Number((await db.query('SELECT count(*) FROM supabase_migrations.schema_migrations')).rows[0].count),0,'UNEXPECTED_HISTORY')
  await db.query('BEGIN')
  await db.query("SET LOCAL statement_timeout='60s'")
  for(const m of list){
    assert(!/^\s*(?:BEGIN|COMMIT);/im.test(m.source),'OUTER_TRANSACTION_REQUIRED')
    await db.query(m.source)
    // This exact migration really ran; no historical migration is invented.
    await db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)',[m.version,m.name,[m.source]])
  }
  await empty(db)
  await db.query('COMMIT')
  const report={success:true,ref,sha,migrations:list.map(m=>({file:m.file,sha256:m.sha256,version:m.version,name:m.name})),originalA6Applied:false,historicalDivergence:'KNOWN_AND_PRESERVED',productionChanged:false,homologChanged:false}
  writeFileSync('rehearsal/reports/NOTIFICACOES_PREVIEW_MIGRATIONS.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report))
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end()}
