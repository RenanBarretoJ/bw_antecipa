import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { suites,stackSpec,assertR110Connection,assertLocalApi } from './r1-10-stack-guard.mjs'
const spec=stackSpec('operators',1791384310691),local={host:'127.0.0.1',port:spec.dbPort,user:'postgres',database:'postgres',application_name:spec.applicationName}
test('all suites have disjoint ports and short distinct project IDs',()=>{
  const specs=Object.keys(suites).map(s=>stackSpec(s,1791384310691)),ports=specs.flatMap(s=>[s.apiPort,s.dbPort,s.shadowPort,s.studioPort,s.mailPort,s.analyticsPort])
  assert.equal(new Set(ports).size,ports.length);assert.equal(new Set(specs.map(s=>s.projectId)).size,specs.length)
  for(const s of specs)assert(s.projectId.length<=36)
})
test('exact local connection and API accepted',()=>{assertR110Connection(local,'operators');assertLocalApi(`http://127.0.0.1:${spec.apiPort}`,spec)})
for(const [field,value] of Object.entries({host:'remote.supabase.co',port:5432,user:'supabase_admin',database:'homolog',application_name:'old_stack'}))test('deny '+field,()=>assert.throws(()=>assertR110Connection({...local,[field]:value})))
test('other suite and remote API denied',()=>{assert.throws(()=>assertR110Connection(local,'automation'));assert.throws(()=>assertLocalApi('https://remote.supabase.co',spec))})
test('fresh runner does not import rejected cloning or kill service sessions',async()=>{
  const source=await readFile('scripts/qa/reconciliation/r1-10-fresh-stack.mjs','utf8')
  assert.doesNotMatch(source,/r1-9-db-prep|pg_dump|pg_restore|pg_terminate_backend|TEMPLATE postgres|--all/)
  assert.match(source,/readMigrationSource/);assert.match(source,/certifyCanonicalFixture/);assert.match(source,/owned\.cleanup/)
})
