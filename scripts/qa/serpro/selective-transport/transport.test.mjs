import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {buildTransaction,hash,loadSources,selection,validateSources,validateTarget} from './policy.mjs'
import {Journal,verifyJournal} from './journal.mjs'
import {classifyError,executeLocal} from './executor.mjs'

const target={mode:'LOCAL_SIMULATED',futureProjectRef:'wwsndnuvnjuabpbjwlck',host:'r46-db',branch:'synthetic-r46',database:'r46_unit',fixture:'r46-synthetic-'+'1'.repeat(32),actor:'r46-local-unit',sessionUser:'postgres',role:'postgres'}
const sources=selection.map(item=>({path:item.path,bytes:readFileSync(item.path)}))
test('exact sealed source loading and no production authority',()=>{
  assert.equal(loadSources(process.cwd()).length,2)
  const prepared=buildTransaction(validateSources(sources)[0],target)
  assert.notEqual(prepared.sqlSha256,prepared.sourceSha256)
  assert.match(prepared.sql,/SET LOCAL lock_timeout='300ms'/)
  assert.match(prepared.sql,/SET LOCAL statement_timeout='1800ms'/)
  assert.ok(prepared.sql.includes(sources[0].bytes.toString('utf8')))
})
for(const mode of ['REMOTE_PRODUCTION','production','REMOTE','',null]) test('remote mode always refused '+String(mode),()=>{
  assert.throws(()=>validateTarget({...target,mode}),/PRODUCTION_GO_NOT_AUTHORIZED/)
})
for(const [field,values] of Object.entries({
  futureProjectRef:['wrong-project','fgttffyrkabpycmbnppi'],
  host:['db.wwsndnuvnjuabpbjwlck.supabase.co','127.0.0.1','::1','r46-db.evil','r46-db/path'],
  database:['postgres','r42_unit','r46_../escape',"r46_x';"],
  fixture:['wwsndnuvnjuabpbjwlck','r46-synthetic-invalid'],
  actor:['postgres','real@example.invalid',"r46-local-x';"],
  branch:['main','homolog','preview/serpro-s22-certificacao'],
  role:['supabase_admin','authenticated'],sessionUser:['supabase_admin','other'],
})) for(const value of values) test('reject target '+field+'='+value,()=>assert.throws(()=>validateTarget({...target,[field]:value})))
test('config cannot add incidental remote flags',()=>assert.throws(()=>validateTarget({...target,remoteAuthorized:true})))
test('refusal happens before connection or journal access',async()=>{
  let connections=0
  await assert.rejects(executeLocal({target:{...target,mode:'REMOTE_PRODUCTION'},sources,connect:()=>{connections++;throw new Error('must never connect')},journal:null}),/PRODUCTION_GO_NOT_AUTHORIZED/)
  assert.equal(connections,0)
})
const mutations=[
  ['extra file',()=>[...sources,sources[0]]],
  ['duplicate',()=>[sources[0],sources[0]]],
  ['inverted',()=>[sources[1],sources[0]]],
  ['traversal',()=>[{...sources[0],path:'../'+sources[0].path},sources[1]]],
  ['alias',()=>[{...sources[0],path:'./'+sources[0].path},sources[1]]],
  ['pilot',()=>[{...sources[0],path:'supabase/migrations/20261028140420_s2_1a1_serpro_selective_pilot_claim.sql'},sources[1]]],
  ['CRLF reformat',()=>[{...sources[0],bytes:Buffer.from(sources[0].bytes.toString().replace(/\r?\n/g,'\r\n'))},sources[1]]],
  ['extra whitespace',()=>[{...sources[0],bytes:Buffer.concat([sources[0].bytes,Buffer.from('\n')])},sources[1]]],
  ['SQL mutation',()=>[{...sources[0],bytes:Buffer.from('BEGIN; SELECT 1; COMMIT;')},sources[1]]],
]
for(const [name,mutate] of mutations) test('refuse manifest '+name,()=>assert.throws(()=>validateSources(mutate())))
test('R42 is not imported or weakened by this envelope',()=>{
  const text=readFileSync('scripts/qa/serpro/s2-2s-local-history-envelope.mjs','utf8')
  assert.match(text,/OWNED_LOCAL_DATABASE_REQUIRED/)
  assert.match(text,/SYNTHETIC_LOCAL_ACTOR_REQUIRED/)
})
test('journal transitions, fsync-backed chain, exclusive creation and tamper detection',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bw-r46-journal-')),path=join(dir,'events.jsonl')
  let journal
  try{
    journal=new Journal(path)
    journal.append({version:selection[0].version,state:'PREPARED'})
    journal.append({version:selection[0].version,state:'IN_PROGRESS',phase:'BEFORE_SQL'})
    journal.append({version:selection[0].version,state:'COMMIT_OUTCOME_UNKNOWN'})
    assert.throws(()=>journal.append({version:selection[0].version,state:'IN_PROGRESS'}),/TRANSITION/)
    assert.throws(()=>new Journal(path),/EEXIST/)
    assert.equal(journal.snapshot().states.get(selection[0].version),'COMMIT_OUTCOME_UNKNOWN')
    const text=readFileSync(path,'utf8')
    assert.throws(()=>verifyJournal(text.replace('BEFORE_SQL','AFTER_SQL')),/DIGEST/)
    assert.equal(verifyJournal(text).records.length,3)
  }finally{journal?.close();rmSync(dir,{recursive:true})}
})
test('journal rejects arbitrary payload and secrets fields',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bw-r46-journal-')),journal=new Journal(join(dir,'events.jsonl'))
  try{assert.throws(()=>journal.append({version:selection[0].version,state:'PREPARED',dsn:'never-log'}),/UNSAFE_FIELD/)}
  finally{journal.close();rmSync(dir,{recursive:true})}
})
for(const [error,reason] of [
  [{code:'55P03',message:'canceling statement due to lock timeout'},'SERVER_LOCK_TIMEOUT'],
  [{code:'57014',message:'canceling statement due to statement timeout'},'SERVER_STATEMENT_TIMEOUT'],
  [{code:'57014',message:'canceling statement due to user request'},'SERVER_QUERY_CANCELLED'],
  [{code:'08006',message:'connection failure'},'SQL_FAILURE'],
  [{code:'ECONNRESET',message:'synthetic disconnect'},'CONNECTION_OR_PROCESS_FAILURE'],
  [{code:'P0001',message:'R46_APPLICATION_BUSY'},'APPLICATION_BUSY'],
]) test('sanitized SQL/transport failure '+reason,()=>assert.equal(classifyError(error).reason,reason))
test('all source hashes equal raw exact bytes, not text normalization',()=>sources.forEach((s,i)=>assert.equal(hash(s.bytes),selection[i].sha256)))
test('busy session refuses before independent precheck and closes connections',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'bw-r46-busy-')),journal=new Journal(join(dir,'events.jsonl'))
  const identity={database:target.database,session_user:'postgres',effective_user:'postgres',fixture:target.fixture,pg_version:170006,ledger_insert:true,public_create:true,private_create:true}
  const state={ledger:[],executions:false,httpAttempts:false,provider:{mode:'OFF_ZERO_BUDGET',cutover:null,capability:'UNVERIFIED',circuit:'OPEN',calls:0}}
  let connections=0,closed=0
  const primary=[]
  const connect=async()=>{
    const index=++connections
    return {
      query:async sql=>{
        if(index===1) {
          primary.push(sql)
          if(sql.includes('pg_try_advisory_lock')) return {rows:[{locked:false}]}
          assert.ok(sql.includes('current_database()'),'BUSY_PATH_MUST_NOT_EXECUTE_DDL_OR_READ_PROVIDER')
          return {rows:[identity]}
        }
        if(sql.includes('current_database()'))return {rows:[identity]}
        if(sql.includes('jsonb_build_object'))return {rows:[{state}]}
        return {rows:[]}
      },
      end:async()=>{closed++},
    }
  }
  try{
    const result=await executeLocal({target,sources,connect,journal})
    assert.equal(result.status,'STOP')
    assert.equal(result.reason,'APPLICATION_BUSY')
    assert.equal(result.nextFileAttempted,false)
    assert.equal(result.automaticRetries,0)
    assert.equal(primary.length,2)
    assert.equal(closed,connections)
    assert.deepEqual(journal.snapshot().records.map(row=>row.state),['PREPARED','FAILED'])
  }finally{journal.close();rmSync(dir,{recursive:true})}
})
