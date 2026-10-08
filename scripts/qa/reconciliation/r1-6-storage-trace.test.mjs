import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { storageTrace } from './r1-6-storage-trace.mjs'
import { hash } from './r1-4-restorer.mjs'
test('trace identifies the exact missing rejection stage without dropping evidence',async()=>{
  const records=[],step=storageTrace('synthetic-correlation',{path:'synthetic/file.pdf'},r=>records.push(r))
  await assert.rejects(step('LATE_REUPLOAD_ATTEMPT',{reject:/FISCAL_STORAGE_FENCE_LOST/},async()=>{}),e=>e.storageStage==='LATE_REUPLOAD_ATTEMPT')
  assert.equal(records[0].result,'FAIL');assert.equal(records[0].actual_outcome,'ALLOWED')
  assert(records[0].started_at&&records[0].completed_at)
  assert.equal(records[0].synthetic_object_path_sha256,hash('synthetic/file.pdf'))
})
test('trace requires the specific domain error and SQLSTATE; legitimate calls pass',async()=>{
  const records=[],step=storageTrace('synthetic-correlation',{path:'synthetic/file.pdf'},r=>records.push(r))
  assert.equal(await step('STORAGE_UPLOAD',{},async()=>123),123)
  const rejection=code=>async()=>{const e=new Error('FISCAL_STORAGE_FENCE_LOST');e.code=code;throw e}
  await step('LATE_DB_INSERT_ATTEMPT',{reject:/FISCAL_STORAGE_FENCE_LOST/,code:'42501'},rejection('42501'))
  assert.equal(records[1].sqlstate,'42501');assert.equal(records[1].result,'PASS')
  await assert.rejects(step('WRONG_SQLSTATE',{reject:/FISCAL_STORAGE_FENCE_LOST/,code:'42501'},rejection('23514')))
  await assert.rejects(step('WRONG_ERROR',{reject:/FISCAL_STORAGE_FENCE_LOST/},async()=>{throw new Error('unrelated')}))
})
test('captured Storage contract is explicit and DDL hashes are raw',async()=>{
  const report=JSON.parse(await readFile('rehearsal/reports/R1_6_TRIGGER_INVENTORY.json','utf8'))
  assert.equal(report.result,'PASS')
  for(const target of report.targets){
    assert(!target.triggers.some(t=>t.classification==='UNKNOWN'))
    for(const t of target.triggers)assert.equal(hash(t.definition),t.raw_trigger_hash)
  }
  const t=report.targets.find(t=>t.name==='homolog').triggers.find(t=>t.schema==='storage'&&t.name==='fiscal_guard_storage_insert')
  assert.equal(t.enabled,'O');assert.equal(t.timing,'BEFORE');assert.equal(t.constraint_trigger,false)
  assert.deepEqual(t.events,['INSERT','UPDATE']);assert.equal(t.function_signature,'private.fiscal_guard_storage_insert()')
})
