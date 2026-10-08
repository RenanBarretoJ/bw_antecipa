import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {actors,cedentes,uid,expectedIds,validateProfile} from './r1-15-rls-fixture.mjs'
import {classifyPolicy} from './r1-15-rls-classify.mjs'
test('actors and rows have stable unique identifiers and real contract roles',()=>{
 assert.equal(actors.length,20);assert.equal(new Set(actors.map(a=>a.id)).size,20)
 assert(actors.every(a=>a.dbRole==='authenticated'&&['cedente','gestor','consultor'].includes(a.role)))
 assert.equal(new Set(cedentes.flatMap(c=>[c.id,c.taxaId,c.devedorId])).size,18)
})
test('automatic Auth profile validation fails closed before adjustments',()=>{
 const a=actors[0],p={id:a.id,email:a.email,role:a.role,status:'ativo',nome_completo:a.name}
 assert.equal(validateProfile([p],a),p)
 for(const rows of [[],[p,p]])assert.throws(()=>validateProfile(rows,a),/CARDINALITY/)
 assert.throws(()=>validateProfile([{...p,role:'gestor'}],a),/UNEXPECTED_CANONICAL_ROLE/)
 assert.throws(()=>validateProfile([{...p,status:'inativo'}],a),/UNEXPECTED_CANONICAL_STATUS/)
})
test('canonical expectations separate delegated access, ownership and fund',()=>{
 for(const table of ['taxas_cedente','devedores_solidarios']){
  assert.deepEqual(expectedIds(actors[0],table,'B'),[])
  assert.deepEqual(expectedIds(actors[1],table,'A'),expectedIds(actors[0],table,'A'))
  assert.deepEqual(expectedIds(actors[2],table,null),[])
  assert.deepEqual(expectedIds(actors[7],table,'GESTOR_OWNER'),[])
  assert.deepEqual(expectedIds(actors[16],table,null),[])
 }
 assert.deepEqual(expectedIds(actors[10],'taxas_cedente','A'),[uid(301)])
 assert.deepEqual(expectedIds(actors[10],'devedores_solidarios','A'),[])
 assert.deepEqual(expectedIds(actors[11],'taxas_cedente',null),[])
})
test('runner rejects bypass actors and preserves security/data between variants',async()=>{
 const source=await readFile('scripts/qa/reconciliation/r1-15-rls-run.mjs','utf8')
 assert.doesNotMatch(source,/DISABLE ROW LEVEL SECURITY|SET.*row_security\s*=\s*off|session_replication_role\s*=\s*replica|CREATE\s+ROLE|GRANT\s+/i)
 for(const s of ["assert.equal(proof.rolsuper,false)","assert.equal(proof.rolbypassrls,false)","assert.equal(guard.owner,false)","assert.equal(guard.active,true)",'assertPolicyOnlyDelta','FIXTURE_CHANGED_BETWEEN_VARIANTS','INDEPENDENT_STACK_RESULT_DRIFT'])assert(source.includes(s),s)
})
test('policy classification cannot hide widening, legitimate loss or legacy extras',()=>{
 const base={table:'x',candidateVariant:'v',added:[],removed:[],legitimateLost:[],candidateUnexpected:[]}
 assert.throws(()=>classifyPolicy([],'x','v'),/EMPTY_MATRIX/)
 assert.equal(classifyPolicy([base],'x','v').classification,'REDUNDANT_REMOVE_FUTURE')
 for(const field of ['added','removed','legitimateLost','candidateUnexpected']){
  assert.equal(classifyPolicy([{...base,[field]:['row']}],'x','v').classification,'MANUAL_DECISION_REQUIRED')
 }
})
