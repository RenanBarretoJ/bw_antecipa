// Characterize historical text transforms offline. No SQL execution or source edit.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {readMigrationSource} from './r1-5-migration-source.mjs'
import {hash} from './r1-4-restorer.mjs'
import {tokens,functionParts} from './r1-14-analysis.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const root='rehearsal/reports/',manifest=JSON.parse(await readFile(root+'R1_5_MANIFESTS.json','utf8'))
const catalog=JSON.parse(await readFile(root+'R1_13_PROD_FINAL_CATALOG.json','utf8')).objects
const versions=['20260824150000','20260806190000','20260826200000','20260826201000','20261006124134']
const source={}
for(const version of versions){const entry=manifest.CLEAN_ROOM_CANONICAL.entries.find(e=>e.version===version);assert(entry);source[version]={entry,...await readMigrationSource(entry)}}
function body(version,name){
 const sql=source[version].sql,pos=sql.indexOf('CREATE OR REPLACE FUNCTION '+name+'(');assert(pos>=0)
 const rest=sql.slice(pos),as=/\bAS\s+(\$\w*\$)/i.exec(rest);assert(as)
 const start=as.index+as[0].length,end=rest.indexOf(as[1],start);assert(end>start)
 return rest.slice(start,end)
}
function replaceOnce(text,old,next){assert.equal(text.split(old).length,2,'SOURCE_ANCHOR_NOT_UNIQUE');return text.replace(old,next)}
function dollarPair(version,anchor){
 const sql=source[version].sql,pos=sql.indexOf(anchor);assert(pos>=0)
 const rest=sql.slice(pos),old=/\$old\$([\s\S]*?)\$old\$/.exec(rest)?.[1],next=/\$new\$([\s\S]*?)\$new\$/.exec(rest)?.[1];assert(old&&next)
 return [old,next]
}
const checks=[]
for(const name of ['private.vincular_comprovante_webhook_entrega','public.desembolsar_operacao_com_logistica','public.registrar_documento_logistico_antecipado']){
 let text=body(name.includes('registrar_documento')?'20260806190000':'20260824150000',name),chain=[]
 if(name.includes('registrar_documento')){
  const sql=source['20260826200000'].sql
  const old='JOIN public.cedentes c ON c.id = nf.cedente_id AND c.user_id = actor_id',next='JOIN public.cedentes c ON c.id = nf.cedente_id AND private.usuario_tem_acesso_cedente(c.id)'
  assert(sql.includes("'"+old+"'"));assert(sql.includes("'"+next+"'"))
  text=replaceOnce(text,old,next);chain=['20260806190000','20260826200000']
 }else{
  if(name.includes('desembolsar')){
   const [old,next]=dollarPair('20260826201000',"'public.desembolsar_operacao_com_logistica(uuid)'")
   text=replaceOnce(text,old,next);chain.push('20260826201000')
  }
  const anchor="p.proname='"+name.split('.')[1]+"'",[old,next]=dollarPair('20261006124134',anchor)
  text=replaceOnce(text,old,next);chain=['20260824150000',...chain,'20261006124134']
 }
 const actual=catalog.find(o=>o.kind==='function'&&o.schema+'.'+o.name===name);assert(actual)
 assert.deepEqual(tokens(text),tokens(functionParts(actual.definition).body),'COMPOSED_SOURCE_DIFFERS')
 const mutant=tokens(text).slice(1);assert.notDeepEqual(mutant,tokens(functionParts(actual.definition).body))
 checks.push({name,result:'PASS',sourceChain:chain.map(v=>({version:v,path:source[v].entry.path,source_commit:source[v].entry.source_commit,blob_oid:source[v].entry.blob_oid,sha256:source[v].entry.sha256})),bodyTokenSha256:hash(JSON.stringify(tokens(text))),negativeControl:'PASS',scope:'Exact historical source anchors composed in memory, executable tokens equal to captured function; no DB execution or ACL inference'})
}
await writeFile(root+'R1_14_COMPOSED_PROVENANCE.json',JSON.stringify({result:'PASS',checks,remoteCalls:0,mutations:0},null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({result:'PASS',functions:checks.map(c=>c.name)}))
