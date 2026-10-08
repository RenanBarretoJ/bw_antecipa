import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile} from 'node:fs/promises'
import yaml from 'js-yaml'
import {render,migrationPath,oldPath,oldHash,mapping} from './r2-2-render.mjs'
import {hash} from './r1-4-restorer.mjs'
import {readMigrationSource,gitBytes} from './r1-5-migration-source.mjs'
const read=p=>readFile(p,'utf8')
const plan=JSON.parse(await read('scripts/qa/reconciliation/ci/r2-2-homolog-plan.json'))
test('New bootstrap changes only the reviewed backfill; historical source is intact',async()=>{
 assert.equal(await read(migrationPath),await render())
 assert.equal(hash(gitBytes(['show','2e8146ebe7582c5bdc10ddee1f8862d806607ee2:'+oldPath])),oldHash)
 assert.equal(hash((await read(oldPath)).replaceAll('\r\n','\n')),oldHash)
})
test('Explicit 19-entry homolog plan has exactly one substitution and no remote authority',async()=>{
 assert.equal(plan.remoteApplicationAuthorized,false);assert.equal(plan.automaticReplayAllowed,false)
 assert.equal(plan.targetProjectRef,'fhgkmggthxikfpogrvaa')
 assert.equal(plan.entries.length,19);assert.equal(new Set(plan.entries.map(e=>e.version)).size,19)
 assert.equal(plan.entries[2].version,'20261008183349')
 assert(!plan.entries.some(e=>e.version===plan.originalBootstrap.version))
 assert.deepEqual(plan.entries[3].dependsOn,['20261008183349'])
 for(const [i,e] of plan.entries.entries()){
  assert.equal(e.order,i+1);assert(e.path.split('/').at(-1).startsWith(e.version+'_'))
  const sql=e.source_kind==='R22_EXPLICIT_MAPPING_EXACT_LF'||e.sourceType?.startsWith('NEW_R1_16')?await read(e.path):(await readMigrationSource(e)).sql
  assert.equal(hash(sql),e.sha256,'SOURCE_HASH:'+e.version)
 }
})
test('Mapping is exact eight actors, 100 principal and 10 adversarial notes',()=>{
 assert.equal(mapping.actors.length,8)
 for(const field of ['id','sacado','cnpj','email'])assert.equal(new Set(mapping.actors.map(a=>a[field])).size,8)
 assert.equal(mapping.actors.reduce((n,a)=>n+a.mainNotes,0),100)
 assert.equal(mapping.actors.reduce((n,a)=>n+a.adversarialNotes,0),10)
 assert.notEqual(mapping.mainFund,mapping.adversarialFund)
})
test('Canonical chain is unchanged; bootstrap is opt-in, never part of automatic replay',async()=>{
 const c=JSON.parse(await read('scripts/qa/reconciliation/ci/contracts.json'))
 assert.equal(c.canonical.applyOrder.length,264)
 assert(c.canonical.applyOrder.includes('20261005154435'))
 assert(!c.canonical.applyOrder.includes('20261008183349'))
 const s=await read('scripts/qa/reconciliation/r2-2-fresh-stack.mjs')
 assert(s.includes("entry.version==='20261005154435'&&atOriginal"))
 assert(s.includes('assertCiOwnedConnection(connection,spec)'))
})
test('Validation publication blocks Vercel and uses only local SQL with cleanup',async()=>{
 const b='validation/r2-2-sacado-mapping',v=JSON.parse(await read('vercel.json'))
 assert.equal(v.git.deploymentEnabled[b],false)
 const w=yaml.load(await read('.github/workflows/reconciliation-certification.yml'))
 const step=w.jobs.sql.steps.find(s=>s.name==='R2.2 explicit mapping clean-room and RLS')
 assert.equal(step.run,'node scripts/qa/reconciliation/r2-2-rehearsal.mjs --local-only')
 assert.equal(step.if,`github.ref == 'refs/heads/${b}' || github.head_ref == '${b}'`)
 assert(!JSON.stringify(w).includes('secrets.'))
 assert.equal(w.jobs.sql.steps.find(s=>s.name==='Cleanup only manifest-owned resources').if,'always()')
 assert(w.jobs.sql.steps.find(s=>s.uses==='actions/upload-artifact@v4').with.path.includes('R2_2_MAPPING_REHEARSAL_*.json'))
})
