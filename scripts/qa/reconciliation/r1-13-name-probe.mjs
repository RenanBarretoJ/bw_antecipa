import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {freshStack} from './r1-10-fresh-stack.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const checkpoint=JSON.parse(await readFile('rehearsal/reports/R1_13_CHECKPOINT.json','utf8'))
const report={at:new Date().toISOString(),result:'IN_PROGRESS',stacks:[],remoteChanges:false}
const file='rehearsal/reports/R1_13_NAME_TYPE_DIAGNOSIS.json'
await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'})
const s=await freshStack('probea',report.stacks)
try{
 await s.db.query("BEGIN READ ONLY;SET LOCAL search_path=''")
 const sql=await readFile('scripts/qa/reconciliation/r1-9-target-catalog.sql','utf8')
 const result=await s.db.query(sql)
 report.fields=result.fields.map(f=>({name:f.name,typeOid:f.dataTypeID}))
 const key=r=>JSON.stringify([r.kind,r.schema,r.name,r.signature]),groups=new Map()
 for(const r of result.rows){const k=key(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}
 report.duplicates=[...groups].filter(([,v])=>v.length>1).map(([key,rows])=>({key,rows}))
 const originalWithoutEnums=checkpoint.catalogSource.replace(/ UNION ALL\r?\n SELECT 'enum',[\s\S]*?(?= UNION ALL\r?\n SELECT 'schema')/,'')
 const old=(await s.db.query(originalWithoutEnums)).rows
 const multiset=rows=>rows.map(r=>JSON.stringify(r)).sort()
 assert.deepEqual(multiset(result.rows.filter(r=>r.kind!=='enum')),multiset(old))
 report.originalNonEnumMultisetEquivalent=true
 report.minimal=(await s.db.query("SELECT pg_typeof(name)::text type,length(name::text) length,name::text FROM (SELECT 'short'::name name UNION ALL SELECT repeat('x',100)::text) q")).rows
 report.textFirst=(await s.db.query("SELECT pg_typeof(name)::text type,length(name::text) length,name::text FROM (SELECT 'short'::name::text name UNION ALL SELECT repeat('x',100)::text) q")).rows
 report.directColumns=(await s.db.query("SELECT c.relname::text||'.'||a.attname::text name,format_type(a.atttypid,a.atttypmod) type FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='nota_fiscal_entrega_postergacoes_canhoto' AND a.attname LIKE 'postergacao_comunicada%' ORDER BY a.attname")).rows
 assert.equal(result.fields.find(f=>f.name==='name').dataTypeID,19)
 assert.equal(report.minimal[1].length,63);assert.equal(report.textFirst[1].length,100)
 report.rootCause='PREEXISTING_UNION_NAME_TYPE_TRUNCATES_COMPOSITE_OBJECT_IDENTIFIERS_TO_63_BYTES'
 report.result='PASS';s.evidence.result='PASS'
}catch(e){report.result='FAIL';report.failure={code:e.code,message:e.message};s.evidence.result='FAIL';process.exitCode=1}
finally{await s.db.query('ROLLBACK').catch(()=>{});await s.close();await writeFile(file,JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({result:report.result,rootCause:report.rootCause,fields:report.fields,minimal:report.minimal,textFirst:report.textFirst,directColumns:report.directColumns,duplicateGroups:report.duplicates?.length,originalNonEnumMultisetEquivalent:report.originalNonEnumMultisetEquivalent,failure:report.failure}))
