import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {readMigrationSource} from './r1-5-migration-source.mjs'
import {hash} from './r1-4-restorer.mjs'
import {equal,functionParts,tokens} from './r1-14-analysis.mjs'
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
export async function loadSources(manifests){
 const sources=[]
 for(const e of manifests.CLEAN_ROOM_CANONICAL.entries){
  if(!['GIT_BLOB','NEW_FORWARD_EXACT_LF','APPROVED_DB_ONLY_EXACT'].includes(e.source_kind)){
   assert(!manifests.CLEAN_ROOM_CANONICAL.applyOrder.includes(e.version),'UNAPPROVED_SOURCE_IN_APPLY_ORDER')
   continue // Excluded runtime/reset artifacts remain excluded; never bypass the source gate.
  }
  const {sql,evidence}=await readMigrationSource(e)
  sources.push({entry:e,sql,evidence,lines:sql.split('\n'),inCanonicalChain:manifests.CLEAN_ROOM_CANONICAL.applyOrder.includes(e.version)})
 }
 const baselines={}
 for(const name of ['prod','homolog']){
  const key=name==='prod'?'PROD_TO_RECONCILED_UPGRADE':'HOMOLOG_TO_RECONCILED_UPGRADE'
  const b=manifests[key].baseline,bytes=await readFile(b.schemaPath),metaBytes=await readFile(b.metadataPath)
  assert.equal(hash(bytes),b.schemaSha256);assert.equal(hash(metaBytes),b.metadataSha256)
  baselines[name]={...b,metadata:JSON.parse(metaBytes),sql:bytes.toString('utf8')}
 }
 return {sources,baselines}
}
export function sourceRef(s,lines=[]){return {version:s.entry.version,path:s.entry.path,source_kind:s.entry.source_kind,source_commit:s.entry.source_commit??null,blob_oid:s.entry.blob_oid??null,sha256:s.entry.sha256,featureSet:s.entry.featureSet,inCanonicalChain:s.inCanonicalChain,lineNumbers:lines}}
export function referencesFor(o,sources){
 const root=o.name.split('.')[0],name=o.kind==='function'?o.name:o.name.split('.').at(-1)
 const re=new RegExp('(?<![A-Za-z_0-9])'+escape(o.kind==='relation'?root:name)+'(?![A-Za-z_0-9])','i')
 return sources.flatMap(s=>{
  const lines=s.lines.flatMap((line,i)=>re.test(line)?[i+1]:[])
  return lines.length?[sourceRef(s,lines)]:[]
 })
}
export function bodyMatches(o,sources){
 const target=tokens(functionParts(o.definition).body),matches=[]
 for(const s of sources){
  const re=new RegExp('CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:"?'+escape(o.schema)+'"?\\.)?"?'+escape(o.name)+'"?\\s*\\(','gi')
  for(const m of s.sql.matchAll(re)){
   const rest=s.sql.slice(m.index),as=/\bAS\s+(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)/i.exec(rest)
   if(!as)continue
   // Do not cross into another function while looking for a body.
   if(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i.test(rest.slice(m[0].length,as.index)))continue
   const start=as.index+as[0].length,end=rest.indexOf(as[1],start);if(end<0)continue
   let same=false;try{same=equal(tokens(rest.slice(start,end)),target)}catch{continue}
   if(same)matches.push({...sourceRef(s,[s.sql.slice(0,m.index).split('\n').length]),match:'EXACT_BODY_TOKENS_LITERALS_PRESERVED',declaration:rest.slice(0,as.index),bodySha256:hash(rest.slice(start,end))})
  }
 }
 return matches
}
export function pathProvenance(path,o,refs,baselines,manifests,bodySources=[]){
 if(path==='cleanroom')return {capture:'R1_13_CLEANROOM.json',chain:'R1_5_MANIFESTS.json:CLEAN_ROOM_CANONICAL',relevantCanonicalSources:refs.filter(r=>r.inCanonicalChain),bodyMatches:bodySources.filter(r=>r.inCanonicalChain),present:!!o,status:bodySources.some(r=>r.inCanonicalChain)?'CANONICAL_BODY_SOURCE_MATCH':'CANONICAL_CHAIN_KNOWN_OBJECT_INTENT_REVIEW_REQUIRED'}
 const b=baselines[path],key=path==='prod'?'PROD_TO_RECONCILED_UPGRADE':'HOMOLOG_TO_RECONCILED_UPGRADE',manifest=manifests[key]
 const versions=new Set(b.metadata.history.map(h=>h.version))
 return {capture:`R1_13_${path.toUpperCase()}_UPGRADE.json`,baselineSchemaPath:b.schemaPath,baselineSha256:b.schemaSha256,baselineMetadataSha256:b.metadataSha256,present:!!o,knownHistoryReferences:refs.filter(r=>versions.has(r.version)).map(r=>({...r,history:b.metadata.history.find(h=>h.version===r.version),historyPresenceDoesNotProveExactBytes:true})),upgradeReferences:refs.filter(r=>manifest.applyOrder.includes(r.version)),bodyMatches:bodySources,status:bodySources.length?'BODY_SOURCE_MATCH_ACL_INTENT_SEPARATE':'UNKNOWN_PROVENANCE',lastIntentionalChange:null,note:'Frozen baseline observation is proven; history version or source mention is not proof of the final intentional grant/DDL.'}
}
