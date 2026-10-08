import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { freshStack } from './r1-10-fresh-stack.mjs'
import { verifyEmailOperators } from '../../email-intake/operators-db.mjs'
import { verifyEmailAutomation } from '../../email-intake/automation-db.mjs'
import { hash } from './r1-4-restorer.mjs'
import { verifyEmailTemporalAdmission } from '../../email-intake/temporal-db.mjs'
import { verifyFiscalFencing } from '../../email-intake/fencing-db.mjs'
import { localStorageFixture } from './r1-2-storage.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
assert.equal(JSON.parse(await readFile('rehearsal/reports/R1_10_STACK_HARNESS.json','utf8')).result,'PASS')
const report={at:new Date().toISOString(),result:'IN_PROGRESS',method:'FRESH_STACK',stacks:[],planned:['operators','automation','credential','inline','cnab','temporal','operational'],tests:[]}
const save=()=>writeFile('rehearsal/reports/R1_10_EXTRA_SQL_SUITES.json',JSON.stringify(report,null,2)+'\n')
try{
  for(const suite of report.planned){
    const s=await freshStack(suite,report.stacks)
    try{
      s.evidence.stage='SQL_SUITE:'+suite
      if(['operators','automation','temporal'].includes(suite)){
        await s.db.query(await readFile('supabase/tests/fixtures/guibor_a5_a6.sql','utf8'))
        s.evidence.checks=await ({operators:verifyEmailOperators,automation:verifyEmailAutomation,temporal:verifyEmailTemporalAdmission}[suite])(s.db,s.connection)
      }else if(suite==='operational'){
        const fixture=await readFile('supabase/tests/c2_1_r2_fluxo_taxa.test.sql','utf8'),setup=fixture.match(/DO \$setup\$[\s\S]*?\$setup\$;/)?.[0]
        assert(setup);const boundary=setup.indexOf('  INSERT INTO public.notas_fiscais (');assert(boundary>0)
        s.evidence.checks=await verifyFiscalFencing(s.db,s.connection,setup.slice(0,boundary)+'END;\n$setup$;',localStorageFixture(s.local,s.spec.projectId,s.connection))
      }else{
        const file={credential:'integration_credential_first.sql',inline:'integration_inline_credentials.sql',cnab:'integration_activation_before_cnab.sql'}[suite]
        const sql=await readFile('supabase/tests/'+file,'utf8'),notices=[]
        s.db.on('notice',n=>{if(/^PASS /.test(n.message))notices.push(n.message)})
        await s.db.query(sql.replace(/^\\set.*$/mg,''));await s.db.query('ROLLBACK')
        assert(notices.length>0);s.evidence.checks=notices;s.evidence.file=file;s.evidence.sqlHash=hash(sql)
      }
      s.evidence.result='PASS'
      report.tests.push({suite,stackId:s.spec.projectId,result:'PASS',checks:s.evidence.checks,checkCount:s.evidence.checks.length,checkUnit:'named scenario groups',migrations:s.evidence.applied.length,fixture:s.evidence.fixture.mode})
    }catch(e){s.evidence.result='FAIL';s.evidence.failure={message:e.message,code:e.code??'ASSERTION',stage:s.evidence.stage};throw e}
    finally{await s.db.query('ROLLBACK').catch(()=>{});await s.close();await save()}
  }
  report.result='PASS'
}catch(e){report.result='FAIL';report.failure={message:e.message,code:e.code??'ASSERTION'};process.exitCode=1}
await save();console.log(JSON.stringify({result:report.result,tests:report.tests.map(t=>({suite:t.suite,result:t.result})),failure:report.failure}))
