import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {freshStack} from './r1-10-fresh-stack.mjs'
import {hash} from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const checkpoint=JSON.parse(await readFile('rehearsal/reports/R1_13_CHECKPOINT.json','utf8'))
assert.equal(await readFile('scripts/qa/reconciliation/r1-9-target-catalog.sql','utf8'),checkpoint.catalogSource,'QUERY_CHANGED_BEFORE_DIAGNOSIS')
const report={at:new Date().toISOString(),result:'IN_PROGRESS',stacks:[],probes:[],querySha256:hash(checkpoint.catalogSource),remoteChanges:false}
const file='rehearsal/reports/R1_13_GROUP_BY_DIAGNOSIS.json'
await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'})
const s=await freshStack('probea',report.stacks)
async function probe(label,sql){
 await s.db.query('BEGIN READ ONLY')
 try{const r=await s.db.query(sql);const result={label,sql,sqlstate:'00000',rows:r.rows};report.probes.push(result);return result}
 catch(e){const result={label,sql,sqlstate:e.code,message:e.message,detail:e.detail,hint:e.hint};report.probes.push(result);return result}
 finally{await s.db.query('ROLLBACK');await writeFile(file,JSON.stringify(report,null,2)+'\n')}
}
try{
 report.postgres=(await probe('version','SELECT version(), current_setting(\'server_version_num\') version_num')).rows
 await probe('A_select_acl','SELECT t.typacl FROM pg_type t LIMIT 1')
 await probe('B_group_acl_only','SELECT t.typacl,count(*) FROM pg_type t GROUP BY t.typacl')
 await probe('C_metadata_no_group',"SELECT n.nspname,t.typname,t.typowner,t.typacl FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('public','private') ORDER BY 1,2")
 const from=" FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname IN ('public','private')"
 const d=await probe('D_ordered_labels_no_acl_group','SELECT n.nspname,t.typname,t.typowner,array_agg(e.enumlabel ORDER BY e.enumsortorder) labels'+from+' GROUP BY n.nspname,t.typname,t.typowner')
 const e=await probe('E_original_enum','SELECT n.nspname,t.typname,t.typowner,t.typacl,array_agg(e.enumlabel ORDER BY e.enumsortorder) labels'+from+' GROUP BY n.nspname,t.typname,t.typowner,t.typacl')
 await probe('F_unordered_aggregate_acl_group','SELECT n.nspname,t.typname,t.typowner,t.typacl,array_agg(e.enumlabel) labels'+from+' GROUP BY n.nspname,t.typname,t.typowner,t.typacl')
 await probe('G_acl_sort','SELECT t.typacl FROM pg_type t ORDER BY t.typacl')
 await probe('H_acl_group_ordered_aggregate','SELECT t.typacl,array_agg(t.oid ORDER BY t.oid) FROM pg_type t GROUP BY t.typacl')
 await probe('I_acl_equality',"SELECT '{}'::aclitem[]='{}'::aclitem[] equal_empty, NULL::aclitem[] IS DISTINCT FROM '{}'::aclitem[] null_distinct_empty")
 report.typacl=(await probe('actual_type',"SELECT format_type(a.atttypid,a.atttypmod) type,format_type(t.typelem,NULL) element_type FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid WHERE a.attrelid='pg_catalog.pg_type'::regclass AND a.attname='typacl'")).rows
 report.operators=(await probe('operators',"SELECT oprname,format_type(oprleft,NULL) left_type,format_type(oprright,NULL) right_type,oprcanhash,oprcanmerge,oprcode::regproc::text function FROM pg_operator WHERE oprleft IN ('aclitem'::regtype,'aclitem[]'::regtype,'anyarray'::regtype) AND oprname IN('=','<','>') ORDER BY 2,1")).rows
 report.opclasses=(await probe('operator_classes',"SELECT a.amname,c.opcname,format_type(c.opcintype,NULL) type,c.opcdefault FROM pg_opclass c JOIN pg_am a ON a.oid=c.opcmethod WHERE c.opcintype IN('aclitem'::regtype,'aclitem[]'::regtype,'anyarray'::regtype) ORDER BY 3,1")).rows
 await probe('original_full_catalog',checkpoint.catalogSource)
 assert.equal(d.sqlstate,'00000');assert.equal(e.sqlstate,'0A000');assert.equal(e.message,'could not implement GROUP BY')
 assert.equal(report.probes.find(p=>p.label==='B_group_acl_only').sqlstate,'00000')
 assert.equal(report.probes.find(p=>p.label==='F_unordered_aggregate_acl_group').sqlstate,'00000')
 assert.equal(report.probes.find(p=>p.label==='H_acl_group_ordered_aggregate').sqlstate,'0A000')
 report.rootCause='ACL_ARRAY_HASH_GROUPING_SUPPORTED_BUT_ORDERED_AGGREGATE_REQUIRES_UNSUPPORTED_ACL_SORT_GROUPING'
 report.result='PASS';s.evidence.result='PASS'
}catch(e){report.result='FAIL';report.failure={code:e.code,message:e.message};s.evidence.result='FAIL';process.exitCode=1}
finally{await s.close();await writeFile(file,JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({result:report.result,rootCause:report.rootCause,typacl:report.typacl,probes:report.probes.map(p=>({label:p.label,sqlstate:p.sqlstate,rows:p.rows?.length,message:p.message})),failure:report.failure,cleanup:s.evidence.cleanup}))
