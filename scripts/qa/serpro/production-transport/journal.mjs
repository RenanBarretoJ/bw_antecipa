import assert from 'node:assert/strict'
import {openSync,writeSync,fsyncSync,closeSync,readFileSync} from 'node:fs'
import {Journal,verifyJournal} from '../selective-transport/journal.mjs'
import {assertPlan,hash,version} from './contract.mjs'

const bindings=new WeakMap()
export class BoundJournal {
  constructor(path,plan){
    assertPlan(plan)
    // Reuse the certified transition machine without changing R46. The sealed
    // sidecar contains public plan metadata, never credentials or SQL bodies.
    const fd=openSync(path+'.plan.json','wx',0o600)
    try{writeSync(fd,JSON.stringify({plan,planSha256:plan.digest})+'\n');fsyncSync(fd)}finally{closeSync(fd)}
    const journal=new Journal(path)
    bindings.set(this,{plan:plan.digest,journal,sidecar:path+'.plan.json'})
  }
  append(event){
    const b=bindings.get(this)
    assert.ok(!('fixture'in event||'transportVersion'in event),'R48_BINDING_OVERRIDE_REFUSED')
    return b.journal.append({...event,transportVersion:version,fixture:'r48-plan-'+b.plan})
  }
  snapshot(){return bindings.get(this).journal.snapshot()}
  close(){bindings.get(this).journal.close()}
}
export function assertJournal(journal,plan){
  assertPlan(plan)
  const b=bindings.get(journal);assert.equal(b?.plan,plan.digest,'R48_JOURNAL_PLAN_MISMATCH')
  const sidecar=JSON.parse(readFileSync(b.sidecar,'utf8'))
  const {digest,...unsigned}=sidecar.plan
  assert.equal(hash(JSON.stringify(unsigned)),digest,'R48_PLAN_SIDECAR_TAMPERED')
  assert.equal(sidecar.planSha256,plan.digest);assert.equal(digest,plan.digest)
  assert.equal(verifyJournal(readFileSync(b.journal.path,'utf8')).records.length,0,'R48_FRESH_JOURNAL_ONLY_NO_RESUME')
}
