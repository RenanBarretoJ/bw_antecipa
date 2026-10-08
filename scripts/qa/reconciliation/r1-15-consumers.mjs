// Read-only source/catalog consumer analysis. Recommendations are not executable SQL.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {hash} from './r1-4-restorer.mjs'
import {aclEntries} from './r1-14-analysis.mjs'
import {loadSources,sourceRef} from './r1-14-provenance.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const root='rehearsal/reports/',read=async n=>JSON.parse(await readFile(root+n+'.json','utf8'))
const checkpoint=await read('R1_15_CHECKPOINT'),old=await read('R1_14_RELATION_ACL_DEPARA'),manifest=await read('R1_5_MANIFESTS')
const remote={prod:(await read('R1_15_PROD_CATALOG')).evidence,homolog:(await read('R1_15_HOMOLOG_CATALOG')).evidence}
const catalogs={prod:(await read('R1_13_PROD_FINAL_CATALOG')).objects,homolog:(await read('R1_13_HOMOLOG_FINAL_CATALOG')).objects,cleanroom:(await read('R1_13_CLEANROOM')).paths[0].applicationObjects}
const {sources}=await loadSources(manifest)
const sourceFiles=[]
for(const f of checkpoint.files)if(/\.(ts|tsx|mjs|sql|md)$/.test(f.path)&&!f.path.startsWith('scripts/qa/reconciliation/'))sourceFiles.push({path:f.path,text:await readFile(f.path,'utf8'),sha256:f.sha256})
const maintenance=/\b(?:TRUNCATE|VACUUM|REINDEX|ANALYZE|CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER|REFERENCES|REFRESH\s+MATERIALIZED\s+VIEW|LOCK\s+TABLE)\b/i
const rows=[]
function evidenceScope(path){
 if(/\.(?:test|spec)\.|(?:^|\/)(?:__tests__|fixtures|qa|rehearsal|homologacao|perf[^/]*)(?:\/|$)|smoke/i.test(path))return 'TEST_OR_FIXTURE'
 if(path.endsWith('.md'))return 'DOCUMENTATION'
 if(path.startsWith('supabase/'))return 'SCHEMA_OR_MIGRATION'
 return path.startsWith('src/')?'APPLICATION_RUNTIME':'SCRIPT_REQUIRES_OPERATOR_CONTEXT'
}
for(const relation of old.rows){
 const name=relation.relation.split('.')[1],direct=[],references=[],sqlConsumers=[],migrationAccess=[]
 for(const f of sourceFiles){
  if(!f.text.includes(name))continue
  const lines=f.text.split('\n'),lineNumbers=lines.flatMap((l,i)=>l.includes(name)?[i+1]:[])
  references.push({path:f.path,sha256:f.sha256,lineNumbers})
  for(const m of f.text.matchAll(new RegExp("\\.from\\(\\s*['\"]"+name+"['\"]\\s*\\)",'g'))){
   const line=f.text.slice(0,m.index).split('\n').length,near=f.text.slice(Math.max(0,m.index-130),m.index+400)
   const browser=/^[\s\r\n]*['"]use client['"]/.test(f.text),admin=/createAdminClient\(\)\s*$/.test(f.text.slice(Math.max(0,m.index-80),m.index))||/\b(adminClient|adminSupabase|supabaseAdmin)\s*$/.test(f.text.slice(Math.max(0,m.index-80),m.index))
   const possibleService=/createAdminClient|createServiceClient|SUPABASE_SERVICE_ROLE_KEY|service_role/.test(f.text)
   const scope=evidenceScope(f.path)
   const classes=scope!=='APPLICATION_RUNTIME'?(scope==='SCRIPT_REQUIRES_OPERATOR_CONTEXT'&&possibleService?['SERVICE_ROLE']:[]):browser?['BROWSER_AUTHENTICATED']:admin?['SERVICE_ROLE']:possibleService?['SERVER_AUTHENTICATED','SERVICE_ROLE']:['SERVER_AUTHENTICATED']
   const chain=f.text.slice(m.index+m[0].length,m.index+m[0].length+350)
   const first=chain.match(/^\s*\.(select|insert|update|delete|upsert)\s*\(/),ops=first?[first[1].toUpperCase()]:[]
   direct.push({path:f.path,line,evidenceScope:scope,classes,classificationConfidence:classes.length>1?'MIXED_CLIENT_FILE_REQUIRES_CALLER_REVIEW':scope==='APPLICATION_RUNTIME'?'STATIC_CONTEXT':'NOT_APPLICATION_RUNTIME_PROOF',operations:ops,requiredPrivileges:ops.flatMap(op=>op==='UPSERT'?['SELECT','INSERT','UPDATE']:[op]),statementExcerpt:near})
  }
 }
 const boundary=new RegExp('(?<![A-Za-z_0-9])'+name+'(?![A-Za-z_0-9])','i')
 for(const o of catalogs.cleanroom.filter(o=>o.kind==='function')){
  if(typeof o.definition!=='string'||!boundary.test(o.definition))continue
  sqlConsumers.push({name:o.schema+'.'+o.name,signature:o.signature,security:/SECURITY DEFINER/.test(o.definition)?'DEFINER':'INVOKER',owner:o.owner,acl:o.acl,definitionSha256:hash(o.definition),matchingLines:o.definition.split('\n').flatMap((l,i)=>boundary.test(l)?[{line:i+1,text:l}]:[]),maintenanceReferences:o.definition.split('\n').filter(l=>boundary.test(l)&&maintenance.test(l)),classification:/SECURITY DEFINER/.test(o.definition)?'POSTGRES_ONLY':'RPC_CALLER_PERMISSIONS'})
 }
 for(const s of sources){
  if(!boundary.test(s.sql))continue
  const lines=s.lines.flatMap((l,i)=>boundary.test(l)&&(/\b(GRANT|REVOKE|CREATE|ALTER|TRUNCATE|REFERENCES|INDEX)\b/i.test(l)||l.includes("'"+name+"'"))?[{line:i+1,text:l}]:[])
  if(lines.length)migrationAccess.push({source:sourceRef(s),lines,classification:'MIGRATION_ONLY',explicitMaintenanceGrant:lines.some(l=>/GRANT\s+.*(?:ALL|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN).*\bTO\s+authenticated/i.test(l.text))})
 }
 const live={}
 for(const p of ['prod','homolog']){
  const r=remote[p].relations.find(r=>r.name===name);assert(r)
  assert.deepEqual([...r.effective_acl].sort(),[...relation.raw[p]].sort(),'LIVE_ACL_DRIFT:'+p+':'+name)
  live[p]={...r,roleAttributes:remote[p].roles,memberships:remote[p].memberships,expandedDirect:aclEntries(r.effective_acl),PUBLIC:aclEntries(r.effective_acl).filter(x=>x.grantee==='PUBLIC'),inheritedPrivilegeExplanation:'pg_has_role USAGE and has_table_privilege are captured separately. Owner powers are not the direct ACL; internal roles remain unchanged.'}
 }
 const changedRole=name==='autorizacoes_acoes_sensiveis'?'service_role':'authenticated'
 const targetAcl=live.prod.raw_relacl.map(item=>{
  const m=item.match(/^([^=]*)=([^/]*)\/(.*)$/);assert(m)
  if(m[1]!==changedRole)return item
  const codes=m[2].replace(/[Dxtm]\*?/g,'');return codes?m[1]+'='+codes+'/'+m[3]:null
 }).filter(Boolean)
 // Only the four explicitly reviewed maintenance privileges change.
 const before=aclEntries(live.prod.raw_relacl),after=aclEntries(targetAcl)
 const removed=before.filter(b=>!after.some(a=>JSON.stringify(a)===JSON.stringify(b)))
 assert.equal(removed.length,4);assert(removed.every(x=>x.grantee===changedRole&&['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].includes(x.privilege)))
 const recentExplicit=migrationAccess.filter(m=>m.explicitMaintenanceGrant&&m.source.version>='20260817150507')
 const runtimeMaintenance=sqlConsumers.flatMap(c=>c.maintenanceReferences.map(l=>({function:c.name,line:l})))
 rows.push({relation:relation.relation,feature:relation.feature,directConsumers:direct,sqlConsumers,migrationAccess,references,consumerClasses:[...new Set([...direct.flatMap(c=>c.classes),...(sqlConsumers.some(c=>c.security==='DEFINER')?['POSTGRES_ONLY']:[]),...(migrationAccess.length?['MIGRATION_ONLY']:[]),...(!direct.length&&!sqlConsumers.length?['NO_RUNTIME_CONSUMER_FOUND']:[])])],liveCatalog:live,cleanroomCapturedAcl:relation.raw.cleanroom,changedRole,proposedTargetAcl:targetAcl,proposedTargetPrivileges:after,removedPrivileges:removed,runtimeMaintenanceConsumers:runtimeMaintenance,recentExplicitMaintenanceGrants:recentExplicit,recommendation:runtimeMaintenance.length||recentExplicit.length?'MANUAL_REVIEW':'TARGET_MAINTENANCE_PRIVILEGES_NONE',rationale:'Static sources and catalog wrappers use ordinary DML or privileged owner execution; no demonstrated need for maintenance grants on the API role. Keep all other role grants and CRUD. Unknown external clients are not proved absent.',origin:'Observed residual privileges predate or survive DML-only hardening; original grantor/intent cannot be attributed solely from default ACL snapshots.',testsRequired:['Assert exact effective privilege matrix, all 8 privileges for each role','Legitimate CRUD/RPC per consumer must remain','D/x/t/m effective false for reviewed API role','service_role password-reset revocation still updates authorizations','Cross-fund, MFA, C5 LEITOR, A6, SACADO, Notifications and Storage regression'],mutated:false})
}
assert.equal(rows.length,57)
await writeFile(root+'R1_15_ACL_CONSUMERS.json',JSON.stringify({at:new Date().toISOString(),rows,scope:'SOURCE_SCAN_PLUS_LIVE_CATALOG_ONLY',sourceFiles:sourceFiles.length,canonicalSources:sources.length,knownLimitations:['Static scan cannot exclude out-of-repository clients','Mixed client files expose candidate contexts; no claim of complete call-graph proof','Maintenance word references require semantic review','No grants or revokes executed'],defaultAcl:{prod:remote.prod.default_acl,homolog:remote.homolog.default_acl},rolePreflightComplete:true},null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({relations:rows.length,directConsumers:rows.reduce((n,r)=>n+r.directConsumers.length,0),sqlConsumers:rows.reduce((n,r)=>n+r.sqlConsumers.length,0),manual:rows.filter(r=>r.recommendation==='MANUAL_REVIEW').map(r=>({relation:r.relation,maintenance:r.runtimeMaintenanceConsumers,grants:r.recentExplicitMaintenanceGrants.length}))}))
