import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { verifyLocalReconciliation } from './s2-2s-manifest.mjs'
const manifest = JSON.parse(readFileSync('scripts/qa/serpro/s2-2s-selective-manifest.json','utf8'))
const text = readFileSync(manifest.localReconciliation.path,'utf8')
const document = JSON.parse(text)
test('all ten recoveries reconcile without rewriting historical snapshots or granting SQL GO', () => {
  const result = verifyLocalReconciliation(manifest,document,text)
  assert.equal(result.rows,10)
  assert.equal(result.sqlApplyAllowed,false)
  assert.equal(document.rows.filter(r=>r.archivedCall).length,7)
  assert.equal(document.rows.filter(r=>r.gitSource).length,3)
  assert.ok(document.caveats.includes('SACADO_GIT_ARCHIVED_AFTER_LEDGER_DATE'))
})
for (const [label, mutate] of [
  ['hash', d=>{d.rows[0].canonicalLfSha256='0'.repeat(64)}],
  ['missing row',d=>{d.rows.pop()}],
  ['fictitious replay',d=>{d.rows[0].replayed=true}],
  ['GO',d=>{d.sqlGo=true}],
  ['remote apply',d=>{d.remoteApplyAllowed=true}],
  ['false current state',d=>{d.liveVerification=true}],
  ['false recovery',d=>{d.rows[0].sourceContentRecovered=false}],
  ['unsuccessful archive',d=>{d.rows[0].archivedCall.isError=true}],
]) test(`reconciliation rejects ${label}`,()=>{
  const altered=structuredClone(document);mutate(altered)
  assert.throws(()=>verifyLocalReconciliation(manifest,altered,text))
})
test('transported evidence bytes are hash checked',()=>{
  assert.throws(()=>verifyLocalReconciliation(manifest,document,text+' '),/RECONCILIATION_HASH/)
})
