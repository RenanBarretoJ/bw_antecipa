import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {hash} from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const read=async p=>JSON.parse(await readFile(p,'utf8'))
const baseline=await read('rehearsal/reports/R1_16_AUTH_BASELINE_1791408722083.json')
assert.equal(baseline.result,'BASELINE_CAPTURED');assert.equal(baseline.cases.length,20)
assert.deepEqual(baseline.unexpected.map(c=>c.actor),['cedente_delegado_revogado_A','cedente_sem_vinculo','cedente_owner_revogado'])
const checkpoint=await read('rehearsal/reports/R1_16_AUTH_BASELINE_1791408722083_CHECKPOINT.json')
for(const f of [...checkpoint.files,...checkpoint.reports])assert.equal(hash(await readFile(f.path)),f.sha256,'BASELINE_ARTIFACT_CHANGED:'+f.path)
const path='supabase/migrations/20261007213327_r1_16_duplicata_authorization_fail_closed.sql',bytes=await readFile(path)
assert(!bytes.includes(13));assert(!/GRANT |REVOKE |DROP POLICY|ALTER TABLE|DISABLE|BYPASSRLS/i.test(bytes.toString('utf8')))
const manifest={at:new Date().toISOString(),result:'PASS',baseline:'R1_16_AUTH_BASELINE_1791408722083.json',authorization:'User authorized isolated investigation and correction after R1.16 functional stop',entry:{path,filename:path.split('/').at(-1),version:'20261007213327',sha256:hash(bytes),lfOnly:true,source:'NEW_R1_16_AUTH_FORWARD',dependencies:['20261007210628'],objects:['public.corrigir_duplicata(uuid,jsonb,text,text)'],prod:'NOT_APPLIED_FUTURE_REVIEW',homolog:'NOT_APPLIED_FUTURE_REVIEW',cleanroom:'APPLY_AFTER_SEVEN_R116_FORWARDS'},historicalPreservation:'PASS',previousR116Forwards:'UNCHANGED',remoteWrites:0}
await writeFile('rehearsal/reports/R1_16_AUTH_FORWARD_MANIFEST.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify(manifest))
