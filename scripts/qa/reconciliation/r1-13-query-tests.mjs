import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {freshStack} from './r1-10-fresh-stack.mjs'
import {hash} from './r1-4-restorer.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const read=async p=>JSON.parse(await readFile(p,'utf8'))
const checkpoint=await read('rehearsal/reports/R1_13_CHECKPOINT.json')
assert.equal((await read('rehearsal/reports/R1_13_GROUP_BY_DIAGNOSIS.json')).result,'PASS')
const sql=await readFile('scripts/qa/reconciliation/r1-9-target-catalog.sql','utf8')
const report={at:new Date().toISOString(),result:'IN_PROGRESS',stacks:[],checks:[],oldHash:hash(checkpoint.catalogSource),newHash:hash(sql),remoteChanges:false}
const file='rehearsal/reports/R1_13_CATALOG_QUERY_TESTS.json'
try{
 const prior=await readFile(file)
 const priorFile=file.replace('.json',`_attempt_${Date.now()}.json`)
 await writeFile(priorFile,prior,{flag:'wx'})
 report.priorAttempt={file:priorFile,sha256:hash(prior)}
}catch(e){if(e.code!=='ENOENT')throw e}
await writeFile(file,JSON.stringify(report,null,2)+'\n')
const s=await freshStack('probeb',report.stacks)
const note=(label,details={})=>{report.checks.push({label,result:'PASS',...details})}
async function capture(){await s.db.query("SET search_path=''");return (await s.db.query(sql)).rows}
async function enumRow(name){const rows=(await capture()).filter(r=>r.kind==='enum'&&r.schema==='public'&&r.name===name);assert.equal(rows.length,1);return rows[0]}
async function savepoint(label,fn){await s.db.query('SAVEPOINT catalog_case');try{await fn();note(label)}finally{await s.db.query('ROLLBACK TO SAVEPOINT catalog_case;RELEASE SAVEPOINT catalog_case')}}
try{
 const baseline=await capture()
 assert(baseline.length>0);assert.equal(new Set(baseline.map(r=>JSON.stringify([r.kind,r.schema,r.name,r.signature]))).size,baseline.length)
 note('FINAL_CATALOG_EXECUTES_WITH_UNIQUE_OBJECT_KEYS',{objects:baseline.length})
 const metadata=(await s.db.query("SELECT t.oid,n.nspname schema,t.typname name,pg_get_userbyid(t.typowner) owner,to_jsonb(t.typacl) acl FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN('public','private') AND t.typtype='e' ORDER BY n.nspname,t.typname")).rows
 for(const t of metadata){
  const labels=(await s.db.query('SELECT enumlabel FROM pg_enum WHERE enumtypid=$1 ORDER BY enumsortorder,enumlabel',[t.oid])).rows.map(r=>r.enumlabel)
  const actual=baseline.find(r=>r.kind==='enum'&&r.schema===t.schema&&r.name===t.name)
  assert.deepEqual(actual,{kind:'enum',schema:t.schema,name:t.name,signature:'',definition:labels,owner:t.owner,acl:t.acl})
 }
 note('ENUM_DECOMPOSED_SEMANTIC_EQUIVALENCE',{enums:metadata.length,fields:['schema','name','labels_order','owner','raw_acl']})
 const originalWithoutEnums=checkpoint.catalogSource.replace(/ UNION ALL\r?\n SELECT 'enum',[\s\S]*?(?= UNION ALL\r?\n SELECT 'schema')/,'')
 assert.notEqual(originalWithoutEnums,checkpoint.catalogSource)
 const oldNonEnums=(await s.db.query(originalWithoutEnums)).rows
 const multiset=rows=>rows.map(r=>JSON.stringify(r)).sort()
 // Preserve original evidence while proving the corrected, non-truncated identity separately.
 const projected=(await s.db.query(`WITH captured AS (${sql.replace(/;\s*$/,'')}) SELECT kind,schema,name::name name,signature,definition,owner,acl FROM captured WHERE kind<>'enum'`)).rows
 assert.deepEqual(multiset(projected),multiset(oldNonEnums))
 note('NON_ENUM_FIELDS_EQUIVALENT_WITH_ORIGINAL_NAME_PROJECTION',{objects:oldNonEnums.length})
 const identities=(await s.db.query("SELECT 'column' kind,n.nspname schema,c.relname::text||'.'||a.attname::text name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname IN('public','private') AND c.relkind IN('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped UNION ALL SELECT 'constraint',n.nspname,c.relname::text||'.'||con.conname::text FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private')")).rows
 assert.deepEqual(multiset(baseline.filter(r=>['column','constraint'].includes(r.kind)).map(({kind,schema,name})=>({kind,schema,name}))),multiset(identities))
 assert(identities.some(r=>r.name.length>63))
 note('FULL_COMPOSITE_IDENTIFIERS_MATCH_DIRECT_CATALOG_NO_TRUNCATION',{objects:identities.length,longNames:identities.filter(r=>r.name.length>63).length})
 assert.deepEqual(await capture(),baseline);note('DETERMINISTIC_REPEAT_CAPTURE')
 await s.db.query('BEGIN')
 try{
  await s.db.query("CREATE TYPE public.r113_qa_enum AS ENUM ('z','a','m');CREATE TYPE public.r113_qa_order AS ENUM ('a','z','m');CREATE TYPE public.r113_qa_labels AS ENUM ('z','b','m')")
  const base=await enumRow('r113_qa_enum'),order=await enumRow('r113_qa_order'),labels=await enumRow('r113_qa_labels')
  assert.deepEqual(base.definition,['z','a','m']);assert.equal(base.acl,null)
  assert.notDeepEqual(base.definition,labels.definition);note('DIFFERENT_ENUM_LABELS_DETECTED')
  assert.deepEqual([...base.definition].sort(),[...order.definition].sort());assert.notDeepEqual(base.definition,order.definition);note('DIFFERENT_ENUM_ORDER_DETECTED')
  await savepoint('DIFFERENT_OWNER_DETECTED',async()=>{
   await s.db.query('CREATE ROLE r113_qa_owner NOLOGIN;GRANT CREATE ON SCHEMA public TO r113_qa_owner;SAVEPOINT owner_permission')
   await assert.rejects(s.db.query('ALTER TYPE public.r113_qa_enum OWNER TO r113_qa_owner'),e=>e.code==='42501'&&e.message==='must be able to SET ROLE "r113_qa_owner"')
   await s.db.query('ROLLBACK TO SAVEPOINT owner_permission;RELEASE SAVEPOINT owner_permission')
   // Only the newly created synthetic owner is granted; the whole case rolls back.
   await s.db.query('GRANT r113_qa_owner TO CURRENT_USER WITH SET TRUE;ALTER TYPE public.r113_qa_enum OWNER TO r113_qa_owner')
   const changed=await enumRow('r113_qa_enum');assert.equal(changed.owner,'r113_qa_owner');assert.notEqual(changed.owner,base.owner);assert.deepEqual(changed.definition,base.definition)
  })
  await savepoint('NULL_VS_EXPLICIT_AND_DIFFERENT_ACL_DETECTED',async()=>{
   await s.db.query('REVOKE ALL ON TYPE public.r113_qa_enum FROM PUBLIC')
   const explicit=await enumRow('r113_qa_enum');assert.notEqual(explicit.acl,null);assert.notDeepEqual(explicit.acl,base.acl)
   await s.db.query('GRANT USAGE ON TYPE public.r113_qa_enum TO authenticated')
   const granted=await enumRow('r113_qa_enum');assert.notDeepEqual(granted.acl,explicit.acl);assert.equal(granted.owner,explicit.owner);assert.deepEqual(granted.definition,explicit.definition)
   report.syntheticAcl={null:base.acl,explicit:explicit.acl,granted:granted.acl}
  })
  const empty=(await s.db.query("SELECT to_jsonb(NULL::aclitem[]) null_acl,to_jsonb('{}'::aclitem[]) empty_acl")).rows[0]
  assert.equal(empty.null_acl,null);assert.deepEqual(empty.empty_acl,[]);assert.notDeepEqual(empty.null_acl,empty.empty_acl);note('RAW_JSON_ACL_NULL_EMPTY_DISTINCTION',empty)
 }finally{await s.db.query('ROLLBACK')}
 assert.equal((await s.db.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='r113_qa_owner'")).rows[0].n,0)
 assert.deepEqual(await capture(),baseline);note('ALL_SYNTHETIC_CATALOG_CHANGES_ROLLED_BACK')
 report.catalog=baseline;report.result='PASS';s.evidence.result='PASS'
}catch(e){report.result='FAIL';report.failure={code:e.code??'ASSERTION',message:e.message,stack:e.stack};s.evidence.result='FAIL';process.exitCode=1}
finally{await s.db.query('ROLLBACK').catch(()=>{});await s.close();await writeFile(file,JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({result:report.result,checks:report.checks,cleanup:s.evidence.cleanup,failure:report.failure}))
