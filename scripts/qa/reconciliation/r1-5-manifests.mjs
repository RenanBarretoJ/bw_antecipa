// Provenance compilation only; no database connection, no checkout changes.
import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { hash } from './r1-4-restorer.mjs'
import { gitBytes,lineEndings,readMigrationSource } from './r1-5-migration-source.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const json=async p=>JSON.parse(await readFile(p,'utf8'))
const previous=await json('rehearsal/reports/R1_UPGRADE_MANIFESTS.json')
const cleanroom=await json('rehearsal/reports/R1_4_MANIFEST_C_CANDIDATE.json')
const sources=[
  {ref:'R1_BASE_MAIN',commit:'2e8146ebe7582c5bdc10ddee1f8862d806607ee2'},
  {ref:'R1_BASE_HOMOLOG',commit:'da884c3ba6e5aceab81db36e469dcbdc812376d2'},
  {ref:'P16_RECOVERED_HISTORY',commit:'dce8b60a89c2bf4aab1b5723ba3666134c5b52dd'},
  {ref:'AUDITED_PR87',commit:'3684227cb59611fbeb99eaa6879c6f890e176d0f'},
  {ref:'AUDITED_PR96',commit:'b733d259a3af3c2646e3b35a0fc40e8790b69a7e'},
]
const forwards=new Set(['20261006201914','20261006210815'])
const provenance=[]
for(const m of previous.PROD_TO_RECONCILED_UPGRADE.entries){
  if(!m.path)continue
  const checkout=await readFile(m.path)
  assert.equal(hash(checkout),m.sha256,`CHECKPOINT_SOURCE_CHANGED:${m.version}`)
  let canonical
  if(forwards.has(m.version)){
    assert.equal(lineEndings(checkout).kind,'LF','FORWARD_REQUIRES_EXPLICIT_FORMATTING')
    canonical={...m,source_kind:'NEW_FORWARD_EXACT_LF',sha256:hash(checkout)}
  }else if(m.version==='20261005173648'){
    canonical={...m,source_kind:'APPROVED_DB_ONLY_EXACT',authorization:'User explicitly approved exact recovered artifact for local R1.5 on 2026-10-07'}
  }else{
    for(const source of sources){
      let oid
      try{oid=gitBytes(['rev-parse',`${source.commit}:${m.path}`]).toString().trim()}catch{continue}
      const bytes=gitBytes(['cat-file','blob',oid])
      // Old normalized hashes are a discovery diagnostic, not the new execution contract.
      if(hash(bytes)!==m.sha256&&hash(bytes)!==m.sha256Lf)continue
      canonical={...m,source_kind:'GIT_BLOB',source_commit:source.commit,source_ref:source.ref,blob_oid:oid,sha256:hash(bytes)}
      break
    }
  }
  if(!canonical){provenance.push({...m,source_kind:'UNRESOLVED_STOP',reason:'No audited Git blob; recovered DB-only artifact requires explicit source decision'});continue}
  canonical.previous_checkout_manifest_sha256=m.sha256
  canonical.previous_lf_diagnostic_sha256=m.sha256Lf
  const resolved=await readMigrationSource(canonical)
  provenance.push({...canonical,provenance:resolved.evidence})
}
const byVersion=new Map(provenance.map(p=>[p.version,p]))
function enrich(plan){
  return {...plan,entries:plan.entries.map(m=>byVersion.has(m.version)?{...byVersion.get(m.version),classification:m.classification}:m),
    unresolved:plan.applyOrder.filter(v=>byVersion.get(v)?.source_kind==='UNRESOLVED_STOP')}
}
const manifest={at:new Date().toISOString(),remoteApplyAllowed:false,
  PROD_TO_RECONCILED_UPGRADE:enrich(previous.PROD_TO_RECONCILED_UPGRADE),
  HOMOLOG_TO_RECONCILED_UPGRADE:enrich(previous.HOMOLOG_TO_RECONCILED_UPGRADE),
  CLEAN_ROOM_CANONICAL:enrich(cleanroom)}
await writeFile('rehearsal/reports/R1_5_MANIFESTS.json',JSON.stringify(manifest,null,2)+'\n')
await writeFile('rehearsal/reports/R1_5_MIGRATION_PROVENANCE.json',JSON.stringify({at:manifest.at,sources,entries:provenance},null,2)+'\n')
console.log(JSON.stringify({resolved:provenance.filter(p=>p.source_kind!=='UNRESOLVED_STOP').length,unresolved:provenance.filter(p=>p.source_kind==='UNRESOLVED_STOP').map(p=>p.version),prod:manifest.PROD_TO_RECONCILED_UPGRADE.unresolved,homolog:manifest.HOMOLOG_TO_RECONCILED_UPGRADE.unresolved,cleanroom:manifest.CLEAN_ROOM_CANONICAL.applyOrder.length}))
