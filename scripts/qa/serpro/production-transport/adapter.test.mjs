import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {preparePlan,assertPlan,sourceEnvelope,hash,version,selection,adapterFingerprint} from './contract.mjs'
import {clientConfiguration,createConnectionFactory} from './connection.mjs'
import {BoundJournal,assertJournal} from './journal.mjs'
import {classifyFailure,executeApprovedPlan} from './executor.mjs'
import {verifySnapshot} from './inspection.mjs'

const digest='a'.repeat(64),ca=Buffer.from('PUBLIC_SYNTHETIC_CA_NOT_A_REAL_CERTIFICATE')
function input(){const now=Date.now();return {
  version,adapterSha256:adapterFingerprint(),kind:'LOCAL_CERTIFICATION',runId:'r48-unit-synthetic-001',projectRef:'r48-synthetic-project',branch:'main',
  endpoint:{host:'r48-db.test.invalid',serverName:'r48-db.test.invalid',port:5432,database:'r48_unit'},actor:'r48-local-unit',sessionUser:'postgres',effectiveRole:'postgres',databaseOid:123,caSha256:hash(ca),
  approval:{kind:'LOCAL_CERTIFICATION',reference:'R48_LOCAL_ONLY',textSha256:digest,acceptedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+300_000).toISOString()},
  evidence:{observedAt:new Date(now-500).toISOString(),cutoff:new Date(now-500).toISOString(),cohort:{count:3,hash:digest,effects:0},ledgerSha256:digest,ledgerContractSha256:digest,catalogStages:[digest,digest,digest],runtimeOff:{worker:false,query:false,contract:false},projectIdentitySha256:digest},
}}
const sources=selection.map(s=>({path:s.path,bytes:readFileSync(s.path)}))
test('sealed plan immutable and source/GO/target bound',()=>{const p=preparePlan(input());assertPlan(p);assert.ok(Object.isFrozen(p.endpoint));assert.match(p.digest,/^[a-f0-9]{64}$/);assert.throws(()=>assertPlan(structuredClone(p)),/PREPARED_PLAN/);assert.throws(()=>{p.endpoint.port=1})})
for(const [name,mutate] of [
  ['unknown field',p=>{p.remoteEnabled=true}],['wrong version',p=>{p.version='v2'}],['source drift',p=>{p.adapterSha256=digest}],
  ['wrong kind',p=>{p.kind='REMOTE'}],['homolog',p=>{p.branch='homolog'}],['wrong project',p=>{p.projectRef='other'}],
  ['public destination',p=>{p.endpoint.host='db.wwsndnuvnjuabpbjwlck.supabase.co'}],['loopback alias',p=>{p.endpoint.host='localhost'}],
  ['wrong TLS hostname',p=>{p.endpoint.serverName='untrusted.invalid'}],['production database',p=>{p.endpoint.database='postgres'}],
  ['wrong database oid',p=>{p.databaseOid=0}],['wrong user',p=>{p.sessionUser='supabase_admin'}],['wrong role',p=>{p.effectiveRole='service_role'}],
  ['invalid actor',p=>{p.actor="r48-local-x';"}],['additional endpoint option',p=>{p.endpoint.sslmode='disable'}],
  ['bad port',p=>{p.endpoint.port=0}],['bad CA',p=>{p.caSha256='invalid'}],['different approval kind',p=>{p.approval.kind='PRODUCTION_SELECTIVE_SQL'}],
  ['missing owner proof',p=>{delete p.approval.textSha256}],['expired approval',p=>{p.approval.expiresAt=new Date(Date.now()-1).toISOString()}],
  ['future approval',p=>{p.approval.acceptedAt=new Date(Date.now()+10_000).toISOString()}],['long window',p=>{p.approval.expiresAt=new Date(Date.now()+3_600_000).toISOString()}],
  ['stale preflight',p=>{p.evidence.observedAt=new Date(Date.now()-700_000).toISOString()}],['missing stages',p=>{p.evidence.catalogStages.pop()}],
  ['enabled runtime',p=>{p.evidence.runtimeOff.worker=true}],['secret in evidence',p=>{p.evidence.password='not-allowed'}],
])test('refuse plan '+name,()=>{const p=input();mutate(p);assert.throws(()=>preparePlan(p))})
test('production contract requires literal direct project/main and non-synthetic actor, no connection',()=>{
  const p=input();p.kind='PRODUCTION_SELECTIVE_SQL';p.projectRef='wwsndnuvnjuabpbjwlck';p.endpoint={host:'db.wwsndnuvnjuabpbjwlck.supabase.co',serverName:'db.wwsndnuvnjuabpbjwlck.supabase.co',port:5432,database:'postgres'};p.actor='Operator Declared';p.approval.kind=p.kind
  const plan=preparePlan(p),cfg=clientConfiguration(plan,{ca,password:'synthetic-password-32-characters-only'})
  assert.equal(cfg.host,p.endpoint.host);assert.equal(cfg.ssl.rejectUnauthorized,true);assert.equal(cfg.ssl.servername,p.endpoint.host)
  assert.equal(cfg.ssl.minVersion,'TLSv1.2');assert.equal('connectionString'in cfg,false)
  for(const change of [x=>{x.endpoint.host+='.'},x=>{x.endpoint.host='evil'+x.endpoint.host},x=>{x.endpoint.port=6543},x=>{x.actor='r48-local-synthetic'}]){const v=structuredClone(p);change(v);assert.throws(()=>preparePlan(v))}
})
test('explicit credentials; reject extra driver options and CA mismatch',()=>{
  const p=preparePlan(input());assert.throws(()=>clientConfiguration(p,{ca,password:'synthetic-password-32-characters-only',ssl:{rejectUnauthorized:false}}))
  assert.throws(()=>clientConfiguration(p,{ca:Buffer.from('WRONG_CA'),password:'synthetic-password-32-characters-only'}),/CA_MISMATCH/)
  const cfg=clientConfiguration(p,{ca,password:'synthetic-password-32-characters-only'})
  assert.equal(cfg.options,'-c client_encoding=UTF8');assert.equal(cfg.enableChannelBinding,true);assert.equal(cfg.statement_timeout,1800)
  assert.ok(cfg.ssl.checkServerIdentity('ignored',{subject:{CN:'evil.invalid'},subjectaltname:'DNS:evil.invalid'}))
})
test('local connections cannot be constructed on host outside Docker',()=>{
  if(!process.env.R48_CONTAINED)assert.throws(()=>createConnectionFactory(preparePlan(input()),{ca,password:'synthetic-password-32-characters-only'}),/CONTAINED_RUNNER/)
})
test('envelope exact bytes, same transaction native history, separate COMMIT',()=>{
  const p=preparePlan(input()),tx=sourceEnvelope(sources,0,p)
  assert.match(tx.guard,/BEGIN;/);assert.match(tx.guard,/300ms/);assert.match(tx.guard,/1800ms/)
  assert.match(tx.guard,/SET LOCAL search_path=pg_catalog/)
  assert.ok(tx.payload.includes(sources[0].bytes.toString('utf8')));assert.ok(tx.payload.includes('INSERT INTO supabase_migrations.schema_migrations'))
  assert.notEqual(tx.sourceSha256,tx.sqlSha256);assert.equal(tx.commitSha256,hash('COMMIT'))
  for(const entries of [[sources[1],sources[0]],[sources[0],sources[0]],[...sources,sources[0]],[{...sources[0],path:'./'+sources[0].path},sources[1]],[{...sources[0],bytes:Buffer.concat([sources[0].bytes,Buffer.from('\n')])},sources[1]]])assert.throws(()=>sourceEnvelope(entries,0,p))
})
test('bound fsync journal, no resume, foreign plan and sidecar tamper refused',()=>{
  const dir=mkdtempSync(join(tmpdir(),'r48-journal-')),file=join(dir,'events.jsonl'),p=preparePlan(input()),j=new BoundJournal(file,p)
  try{
    assertJournal(j,p);const other=preparePlan({...input(),runId:'r48-unit-synthetic-002'});assert.throws(()=>assertJournal(j,other),/MISMATCH/)
    assert.throws(()=>j.append({version:selection[0].version,state:'PREPARED',fixture:'other'}),/BINDING_OVERRIDE/)
    assert.throws(()=>j.append({version:selection[0].version,state:'PREPARED',password:'never-log'}),/UNSAFE_FIELD/)
    const sidecar=readFileSync(file+'.plan.json','utf8');writeFileSync(file+'.plan.json',sidecar.replace('r48-local-unit','r48-local-other'));assert.throws(()=>assertJournal(j,p),/TAMPERED/)
    writeFileSync(file+'.plan.json',sidecar);j.append({version:selection[0].version,state:'PREPARED'});assert.throws(()=>assertJournal(j,p),/NO_RESUME/)
    j.append({version:selection[0].version,state:'IN_PROGRESS'});j.append({version:selection[0].version,state:'COMMIT_OUTCOME_UNKNOWN'})
    assert.throws(()=>j.append({version:selection[0].version,state:'COMMIT_CONFIRMED'}),/TRANSITION/)
    assert.ok(j.snapshot().records.every(r=>r.fixture==='r48-plan-'+p.digest))
  }finally{j.close();rmSync(dir,{recursive:true})}
})
test('unbranded connection factory refused before network or journal',async()=>{
  let connected=0;await assert.rejects(executeApprovedPlan({plan:preparePlan(input()),sources,factory:{connect(){connected++}},journal:null}),/FACTORY_PLAN_MISMATCH/);assert.equal(connected,0)
})
for(const [error,expected]of [[{code:'ERR_TLS_CERT_ALTNAME_INVALID'},'TLS_VERIFICATION_FAILED'],[{code:'55P03',message:'lock timeout'},'SERVER_LOCK_TIMEOUT'],[{code:'57014',message:'statement timeout'},'SERVER_STATEMENT_TIMEOUT'],[{code:'ECONNRESET'},'CONNECTION_OR_PROCESS_FAILURE'],[{message:'R48_APPLICATION_BUSY'},'R48_APPLICATION_BUSY']])test('failure remains fail closed '+expected,()=>assert.equal(classifyFailure(error).reason,expected))
test('snapshot fails on unexpected provider, catalog, pilots or native history',()=>{
  const p=preparePlan(input()),s={ledger:[],baselineLedgerSha256:digest,ledgerContractSha256:digest,catalogStageSha256:digest,pilots:0,provider:{capability:'UNVERIFIED',circuit:'OPEN',budget:0,calls:0,mode:'OFF_ZERO_BUDGET',cutover:null,oauth:0,get:0},cohort:{count:3,hash:digest,effects:0},addedTables:[]}
  verifySnapshot(s,0,p)
  for(const change of [v=>{v.provider.calls=1},v=>{v.catalogStageSha256='b'.repeat(64)},v=>{v.pilots=1},v=>{v.baselineLedgerSha256='b'.repeat(64)},v=>{v.ledgerContractSha256='b'.repeat(64)},v=>{v.cohort.effects=1},v=>{v.addedTables.push({owner:'postgres',rls:false,force_rls:true})}]){const v=structuredClone(s);change(v);assert.throws(()=>verifySnapshot(v,0,p))}
})
test('old R46 guards remain mandatory and unchanged in purpose',async()=>{const {validateTarget}=await import('../selective-transport/policy.mjs');assert.throws(()=>validateTarget({mode:'PRODUCTION_SELECTIVE_SQL'}),/PRODUCTION_GO_NOT_AUTHORIZED/)})
