import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {freshStack} from './r1-10-fresh-stack.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const checkpoint=JSON.parse(await readFile('rehearsal/reports/R1_13_CHECKPOINT.json','utf8'))
const sql=await readFile('scripts/qa/reconciliation/r1-9-target-catalog.sql','utf8')
const report={at:new Date().toISOString(),result:'IN_PROGRESS',stacks:[],scope:'READ_ONLY_CATALOG_DUPLICATE_CHARACTERIZATION'}
const file='rehearsal/reports/R1_13_DUPLICATE_PROBE.json'
await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'})
const s=await freshStack('probea',report.stacks)
try{
 await s.db.query("BEGIN READ ONLY;SET LOCAL search_path=''")
 report.catalog=(await s.db.query(sql)).rows
 const originalWithoutEnums=checkpoint.catalogSource.replace(/ UNION ALL\r?\n SELECT 'enum',[\s\S]*?(?= UNION ALL\r?\n SELECT 'schema')/,'')
 const old=(await s.db.query(originalWithoutEnums)).rows
 assert.deepEqual(report.catalog.filter(r=>r.kind!=='enum'),old)
 report.nonEnumPreservation='PASS'
 const groups=new Map()
 for(const r of report.catalog){const key=JSON.stringify([r.kind,r.schema,r.name,r.signature]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}
 report.duplicates=[...groups].filter(([,rows])=>rows.length>1).map(([key,rows])=>({key,rows,exactDuplicate:rows.every(r=>JSON.stringify(r)===JSON.stringify(rows[0]))}))
 report.result='PASS_CHARACTERIZED';s.evidence.result='PASS'
}catch(e){report.result='FAIL';report.failure={code:e.code,message:e.message};s.evidence.result='FAIL';process.exitCode=1}
finally{await s.db.query('ROLLBACK').catch(()=>{});await s.close();await writeFile(file,JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({result:report.result,nonEnumPreservation:report.nonEnumPreservation,duplicates:report.duplicates?.map(d=>({key:d.key,count:d.rows.length,exact:d.exactDuplicate})),failure:report.failure}))
