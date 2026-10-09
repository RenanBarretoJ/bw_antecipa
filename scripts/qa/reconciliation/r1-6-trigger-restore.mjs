import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { hash } from './r1-4-restorer.mjs'
const ident=s=>'"'+s.replaceAll('"','""')+'"'
export async function applicationTriggers(db){
  await db.query("SET search_path=''")
  const all=(await db.query(await readFile('scripts/qa/reconciliation/r1-6-trigger-catalog.sql','utf8'))).rows[0].triggers
  assert(!all.some(t=>t.classification==='UNKNOWN'),'UNKNOWN_LOCAL_TRIGGER_STOP')
  return all.filter(t=>t.classification==='APPLICATION_MANAGED')
}
export async function restoreAndCertifyApplicationTriggers(db,name){
  const inventory=JSON.parse(await readFile('rehearsal/reports/R1_6_TRIGGER_INVENTORY.json','utf8'))
  assert.equal(inventory.result,'PASS')
  const source=inventory.targets.find(t=>t.name===name)
  const expected=source.triggers.filter(t=>t.classification==='APPLICATION_MANAGED')
  assert.equal(hash(JSON.stringify(expected)),source.applicationSha256,'TRIGGER_SOURCE_HASH_CHANGED')
  const created=[]
  for(const t of expected){
    assert.equal(hash(t.definition),t.raw_trigger_hash,'RAW_TRIGGER_DDL_CHANGED')
    const relation=ident(t.schema)+'.'+ident(t.table)
    assert((await db.query('SELECT to_regclass($1) relation,to_regprocedure($2) fn',[relation,t.function_signature])).rows[0].fn,'TRIGGER_FUNCTION_DEPENDENCY_MISSING')
    const found=(await db.query('SELECT t.tgenabled FROM pg_trigger t WHERE t.tgrelid=$1::regclass AND t.tgname=$2',[relation,t.name])).rows[0]
    if(!found){
      assert(!['public','private'].includes(t.schema),'SNAPSHOT_INTERNAL_APPLICATION_TRIGGER_MISSING')
      await db.query(t.definition)
      created.push({name:t.schema+'.'+t.table+'.'+t.name,RAW_TRIGGER_HASH:hash(t.definition)})
    }
    if((found?.tgenabled??'O')!==t.enabled){
      const mode={O:'ENABLE',D:'DISABLE',R:'ENABLE REPLICA',A:'ENABLE ALWAYS'}[t.enabled]
      assert(mode,'UNKNOWN_TRIGGER_ENABLED_STATE')
      await db.query(`ALTER TABLE ${relation} ${mode} TRIGGER ${ident(t.name)}`)
    }
  }
  const actual=await applicationTriggers(db)
  assert.deepEqual(actual,expected,'APPLICATION_TRIGGER_FIDELITY_STOP')
  await db.query('SET search_path=public,extensions')
  return {result:'PASS',count:actual.length,created,applicationSha256:hash(JSON.stringify(actual)),triggers:actual}
}
