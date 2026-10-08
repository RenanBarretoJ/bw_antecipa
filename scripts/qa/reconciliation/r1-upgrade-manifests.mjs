// Reviewed upgrade inventory. This generator cannot apply migrations or contact a remote.
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const read=async p=>JSON.parse(await readFile(p,'utf8'))
const hash=s=>createHash('sha256').update(s).digest('hex')
const capture=await read('rehearsal/reports/R1_SCHEMA_ONLY_BASELINES.json')
assert.equal(capture.result,'PASS')
const baselines={}
for(const t of capture.targets){
  assert.equal(hash(await readFile(t.schemaPath)),t.schemaSha256)
  assert.equal(hash(await readFile(t.metadataPath)),t.metadataSha256)
  baselines[t.name]=await read(t.metadataPath)
}
const r11=await read('scripts/qa/reconciliation/r1-1-focused-manifest.json')
const r13=await read('scripts/qa/reconciliation/r1-3-focused-manifest.json')
for(const m of [...r11,...r13])assert.equal(hash(await readFile(m.path)),m.sha256)
const forwards=['20261006201914','20261006210815']
const prodApply=[...r11.map(m=>m.path.split('/').at(-1).split('_')[0]),forwards[1]]
const homologApply=['20261001182744','20261002205122','20261005154435','20261005173648',
  '20261005204958','20261005213812','20261006114841','20261006124134','20261006130657',...forwards]
const aliases={
  '20260829170408':'20260829173938','20260915175435':'20260915192524',
  '20260916140000':'20260916144655','20260916150333':'20260916153942',
}
const qa=new Set(['20260827150923','20260922161558','20260909024514'])
const c5=new Set(['20260925212843','20260928130825','20260928143646'])
const files=await readdir('supabase/migrations')
const inventory=new Map()
for(const file of files.filter(f=>/^\d+_.*\.sql$/.test(f))){
  const version=file.split('_')[0],path='supabase/migrations/'+file
  assert(!inventory.has(version),'VERSION_COLLISION')
  const bytes=await readFile(path)
  inventory.set(version,{version,name:file.slice(version.length+1,-4),path,sha256:hash(bytes),sha256Lf:hash(bytes.toString('utf8').replaceAll('\r\n','\n'))})
}
for(const b of Object.values(baselines))for(const m of b.history){
  if(!inventory.has(m.version))inventory.set(m.version,{version:m.version,name:m.name,path:null,sha256:null,sha256Lf:null})
}
const all=[...inventory.values()].sort((a,b)=>a.version.localeCompare(b.version))
const feature=m=>/c5_|guibor_a6/.test(m.name)?'C5_A6':/email_|fiscal_intake/.test(m.name)?'RLX_DOC':/notificacoes/.test(m.name)?'NOTIFICATIONS':/sacado/.test(m.name)?'SACADO':/nfse|health/.test(m.name)?'HEALTH':/integration/.test(m.name)?'INTEGRATIONS':'BASELINE'
function entry(m,classification,b){return {...m,classification,featureSet:feature(m),historyHash:b?.history.find(x=>x.version===m.version)?.sha256??null,
  preconditions:['LOCAL_ONLY','Pinned schema and metadata hashes','Pinned file SHA256 before apply'],
  postconditions:['No history insertion or repair','No production or homolog writes','A6 R2 ACL and P16 preserved']}}
function upgrade(name,apply){
  const b=baselines[name],known=new Set(b.history.map(m=>m.version))
  const entries=all.map(m=>{
    let classification
    if(qa.has(m.version))classification='ENV_SPECIFIC_DO_NOT_APPLY'
    else if(m.version==='002')classification='BASELINE_ONLY'
    else if(c5.has(m.version)&&name==='prod')classification='SUPERSEDED_BY_FORWARD_COMPAT'
    else if(m.version==='20260929193129')classification=name==='prod'?'INTENTIONAL_EXCEPTION_DO_NOT_APPLY':'ALREADY_APPLIED_HISTORICAL_HOMOLOG_ONLY'
    else if(known.has(m.version))classification='ALREADY_APPLIED'
    else if(aliases[m.version]&&known.has(aliases[m.version])||Object.entries(aliases).some(([a,z])=>z===m.version&&known.has(a)))classification='HISTORICAL_ALIAS'
    else if(m.version==='20260922182301'&&known.has('20260928185439'))classification='SUPERSEDED_BY_P16_DO_NOT_APPLY'
    else if(apply.includes(m.version))classification='APPLY_REQUIRED'
    else classification='UNREVIEWED_STOP'
    const e=entry(m,classification,b)
    if(classification==='APPLY_REQUIRED')assert(e.path&&!known.has(m.version),'INVALID_APPLY_ENTRY')
    return e
  })
  const unknown=entries.filter(e=>e.classification==='UNREVIEWED_STOP')
  assert.deepEqual(unknown.map(x=>x.version),[],`${name}:UNCLASSIFIED_MIGRATIONS`)
  assert.deepEqual(entries.filter(e=>e.classification==='APPLY_REQUIRED').map(e=>e.version),[...apply].sort())
  return {baseline:capture.targets.find(t=>t.name===name),applyOrder:apply,entries}
}
const result={at:new Date().toISOString(),scope:'FULL_UPGRADE_MANIFESTS_A_B_D_E; CLEAN_ROOM_C_REQUIRES_SEPARATE_CANONICAL_CERTIFICATION',remoteApplyAllowed:false,
  PRODUCTION_BASELINE:{...capture.targets.find(t=>t.name==='prod'),entries:baselines.prod.history.map(m=>entry(inventory.get(m.version),'BASELINE_ONLY',baselines.prod))},
  HOMOLOG_BASELINE:{...capture.targets.find(t=>t.name==='homolog'),entries:baselines.homolog.history.map(m=>entry(inventory.get(m.version),'BASELINE_ONLY',baselines.homolog))},
  PROD_TO_RECONCILED_UPGRADE:upgrade('prod',prodApply),HOMOLOG_TO_RECONCILED_UPGRADE:upgrade('homolog',homologApply),
  CLEAN_ROOM_CANONICAL:{status:'NOT_CERTIFIED',note:'R1.3 historical focused chain is not the full R1 clean-room.'}}
await writeFile('rehearsal/reports/R1_UPGRADE_MANIFESTS.json',JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({prodApply,homologApply,manifestEntries:all.length,remoteApplyAllowed:false}))
