import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {loadSources,sourceRef} from './r1-14-provenance.mjs'
import {gitBytes} from './r1-5-migration-source.mjs'
import {hash} from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const dir='rehearsal/reports/',read=async n=>JSON.parse(await readFile(dir+n+'.json','utf8'))
const {sources}=await loadSources(await read('R1_5_MANIFESTS'))
const cp=await read('R1_15_CHECKPOINT'),acl=await read('R1_15_ACL_CONSUMERS')
const sourceAudit=[],bootstrap=[],escrow=[],encoding=[]
for(const s of sources){
 const statements=[...s.sql.matchAll(/\bGRANT\s+[^;]+;/gi)].map(m=>({statement:m[0],line:s.sql.slice(0,m.index).split('\n').length}))
 const relevant=statements.filter(x=>/\b(?:ALL|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN)\b/i.test(x.statement))
 if(relevant.length)sourceAudit.push({source:sourceRef(s),statements:relevant})
 if(s.sql.includes('bootstrap_producao'))bootstrap.push({source:sourceRef(s),kind:'CANONICAL_SOURCE_LITERAL'})
 const lines=s.lines.flatMap((l,i)=>/sacado_(?:banco|agencia|conta|tipo_conta)_escrow/.test(l)?[{line:i+1,text:l}]:[])
 if(lines.length)escrow.push({source:sourceRef(s),lines})
 if(s.sql.includes('corrigir_duplicata')){
  const patterns=[...s.sql.matchAll(/lower\(p_campos->>'aceite_textual'\) LIKE '([^']+)'/g)].map(m=>({literal:m[1],codepoints:[...m[1]].map(c=>c.codePointAt(0)),line:s.sql.slice(0,m.index).split('\n').length}))
  if(patterns.length)encoding.push({source:sourceRef(s),patterns})
 }
}
const grantsByRelation=acl.rows.map(row=>{
 const relation=row.relation.split('.')[1],b=new RegExp('\\b'+relation+'\\b','i')
 const matches=sourceAudit.flatMap(s=>s.statements.filter(x=>(b.test(x.statement)||/ALL TABLES IN SCHEMA\s+public/i.test(x.statement))&&new RegExp('\\bTO\\s+[^;]*\\b'+row.changedRole+'\\b','i').test(x.statement)).map(x=>({...x,source:s.source})))
 return {relation:row.relation,role:row.changedRole,maintenanceGrants:matches,recentMaintenanceGrants:matches.filter(x=>x.source.version>='20260817150507')}
})
assert(grantsByRelation.every(x=>x.recentMaintenanceGrants.length===0),'INTENTIONAL_RECENT_GRANT_REQUIRES_REVIEW')
const sourceRefs=[]
for(const f of cp.files){
 if(!/\.(ts|tsx|mjs|sql|md)$/.test(f.path)||f.path.startsWith('scripts/qa/reconciliation/'))continue
 const text=await readFile(f.path,'utf8')
 if(!/sacado_(?:banco|agencia|conta|tipo_conta)_escrow|bootstrap_producao/.test(text))continue
 sourceRefs.push({path:f.path,sha256:hash(text),lines:text.split('\n').flatMap((line,i)=>/sacado_(?:banco|agencia|conta|tipo_conta)_escrow|bootstrap_producao/.test(line)?[{line:i+1,text:line}]:[])})
}
const clean=(await read('R1_13_CLEANROOM')).paths[0].applicationObjects
const escrowRuntime=clean.filter(o=>['function','view','policy','trigger'].includes(o.kind)&&/sacado_(?:banco|agencia|conta|tipo_conta)_escrow/.test(JSON.stringify(o.definition))).map(o=>({kind:o.kind,schema:o.schema,name:o.name}))
const bootstrapGit=gitBytes(['log','--all','--oneline','-S','bootstrap_producao','--','scripts','docs','supabase']).toString('utf8').trim()
const exactTriggers=Object.fromEntries(['prod','homolog','cleanroom'].map(env=>[env,clean.filter(o=>o.kind==='trigger'&&/^(taxas_cedente|consultor_cedente)\./.test(o.name)).map(o=>({name:o.name,definition:o.definition}))]))
// Capture paths separately: never use the plural consultor_cedentes as evidence for singular table.
for(const env of ['prod','homolog'])exactTriggers[env]=(await read('R1_13_'+env.toUpperCase()+'_FINAL_CATALOG')).objects.filter(o=>o.kind==='trigger'&&/^(taxas_cedente|consultor_cedente)\./.test(o.name)).map(o=>({name:o.name,definition:o.definition}))
await writeFile(dir+'R1_15_SOURCE_AUDIT.json',JSON.stringify({at:new Date().toISOString(),canonicalSources:sources.length,grantsByRelation,allMaintenanceGrantStatements:sourceAudit,originalGrantIntent:'Unknown unless explicitly evidenced; multiline statements included; no global ACL precedence.',bootstrapCanonicalOccurrences:bootstrap,bootstrapGitPickaxe:{command:'git log --all --oneline -S bootstrap_producao -- scripts docs supabase',output:bootstrapGit},escrowCanonicalReferences:escrow,sourceRefs,escrowRuntimeCatalogReferences:escrowRuntime,timestampExactTableTriggers:exactTriggers,encodingCanonicalSources:encoding,sqlExecuted:false},null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({sources:sources.length,recentMaintenanceGrants:grantsByRelation.reduce((n,x)=>n+x.recentMaintenanceGrants.length,0),bootstrapCanonicalOccurrences:bootstrap.length,bootstrapGitOutput:!!bootstrapGit,escrowRuntimeReferences:escrowRuntime.length,encodingSources:encoding.length}))
