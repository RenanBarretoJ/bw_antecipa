// Compile an explicit candidate from the reviewed inventory, never apply a directory glob.
import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { fileSha256 } from '../../perf9e/clean-room-lib.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const read=async p=>JSON.parse(await readFile(p,'utf8'))
assert.equal((await read('rehearsal/reports/R1_4_RESTORE.json')).result,'PASS')
const inventory=(await read('rehearsal/reports/R1_UPGRADE_MANIFESTS.json')).PROD_TO_RECONCILED_UPGRADE.entries
const exclusions={
  '20260723182639':'Homolog operational reset RPC',
  '20260728153646':'Homolog reset extension',
  '20260804103235':'Homolog reset extension',
  '20260811153000':'Homolog reset extension',
  '20260823125731':'Homolog reset extension',
  '20260827150923':'Homolog-only user reset',
  '20260922161558':'Homolog runtime/history repair',
  '20260909024514':'Production environment-specific super-admin bootstrap',
  '20260827213304':'Environment-specific historical business data patch; not schema construction',
}
const aliases=new Set(['20260829173938','20260915192524','20260916144655','20260916153942'])
const entries=inventory.map(m=>{
  if(exclusions[m.version])return {...m,classification:'ENV_SPECIFIC_DO_NOT_APPLY',reason:exclusions[m.version]}
  if(aliases.has(m.version))return {...m,classification:'HISTORICAL_ALIAS_DO_NOT_APPLY'}
  assert(m.path&&fileSha256(m.path)===m.sha256,`CANONICAL_SOURCE_MISSING:${m.version}`)
  return {...m,classification:m.version==='002'?'BOOTSTRAP_CANONICAL':m.version==='20260929193129'?'APPLY_HISTORICAL_CLEANROOM_ONLY':'APPLY_CANONICAL',
    preconditions:['Owned fresh local Supabase platform','Previous explicit manifest entry succeeded','Raw file hash matches'],
    postconditions:['No remote mutation','No history repair','No runtime seed or live job']}
})
const applyOrder=entries.filter(m=>/^(BOOTSTRAP|APPLY)_/.test(m.classification)).map(m=>m.version)
assert.equal(applyOrder[0],'002')
for(const v of ['20260928185439','20261005173648','20261006201914','20261006210815'])assert(applyOrder.includes(v))
assert(applyOrder.indexOf('20260928130825')<applyOrder.indexOf('20260929193129'))
assert(applyOrder.indexOf('20260929193129')<applyOrder.indexOf('20260929215557'))
const result={at:new Date().toISOString(),scope:'CLEAN_ROOM_CANONICAL_ONLY_NOT_PRODUCTION_UPGRADE',status:'CANDIDATE_NOT_CERTIFIED',
  orderContract:'002 baseline, numeric 003-016, explicit historical chronology, original A6 only here before A6 R2, R1.1/R1.3 forwards last',
  excludedResetAndEnvironmentVersions:Object.keys(exclusions),applyOrder,entries}
await writeFile('rehearsal/reports/R1_4_MANIFEST_C_CANDIDATE.json',JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({status:result.status,applyCount:applyOrder.length,excluded:entries.length-applyOrder.length}))
