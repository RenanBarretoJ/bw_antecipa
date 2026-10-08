import assert from 'node:assert/strict'
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { configureDisposableToml,sanitizedLocalEnvironment,redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'
import { disposableResources,nativeSupabaseCli } from '../../email-intake/disposable-resources.mjs'
import { readMigrationSource } from './r1-5-migration-source.mjs'
import { hash } from './r1-4-restorer.mjs'
import { certifyCanonicalFixture } from './r1-7-fixture-certification.mjs'
import { portPreflight,recordPortOwnership,assertCiOwnedConnection,assertCiApi } from './r1-19-port-contract.mjs'
const read=p=>readFile(p,'utf8')
const ident=s=>'"'+s.replaceAll('"','""')+'"'
// Dedicated R2.2 route; the certified canonical factory remains unchanged.
export async function freshMappingStack(records, atOriginal){
  const preflight=await portPreflight(),spec=preflight.spec,{projectId,suite}=spec,root=resolve('rehearsal/tmp',projectId)
  const evidence={suite,projectId,ports:{api:spec.apiPort,db:spec.dbPort},source:'CLEAN_ROOM_CANONICAL',method:'FRESH_STACK',stage:'PREFLIGHT',result:'IN_PROGRESS',applied:[],checks:[],cleanup:'NOT_RUN'}
  records.push(evidence)
  const reportPath=`rehearsal/reports/${projectId}-suite.json`,persist=()=>writeFile(reportPath,JSON.stringify(evidence,null,2)+'\n')
  const contract=JSON.parse(await read('scripts/qa/reconciliation/ci/contracts.json')),plan=contract.canonical
  assert.equal(contract.remoteDatabaseAllowed,false);assert.equal(contract.historicalMigrationsMutable,false)
  assert.deepEqual(plan.unresolved,[]);assert.equal(plan.applyOrder.length,264)
  assert.equal(plan.entries.filter(m=>m.classification.endsWith('DO_NOT_APPLY')).length,13)
  evidence.manifestHash=hash(await readFile('scripts/qa/reconciliation/ci/contracts.json'));evidence.excluded=13
  const sources=[]
  for(const version of plan.applyOrder){const entry=plan.entries.find(e=>e.version===version),source=await readMigrationSource(entry);assert.equal(hash(Buffer.from(source.sql,'utf8')),entry.sha256);sources.push({entry,source})}
  await mkdir(resolve(root,'supabase/migrations'),{recursive:true})
  await writeFile(resolve(root,'supabase/config.toml'),configureDisposableToml(await read('supabase/config.toml'),spec))
  const owned=await disposableResources({projectId,file:`rehearsal/reports/${projectId}-resources.json`,tempDirs:[root]})
  await recordPortOwnership(owned,preflight,`rehearsal/reports/${projectId}-resources.json`)
  const env=sanitizedLocalEnvironment()
  for(const key of Object.keys(env))if(/SUPABASE|DATABASE|POSTGRES|EMAIL_INTAKE|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI/i.test(key))delete env[key]
  const cli=await nativeSupabaseCli()
  const run=args=>new Promise((done,reject)=>{const p=spawn(cli,[...args,'--workdir',root],{env,windowsHide:true});let output='';for(const s of [p.stdout,p.stderr])s.on('data',b=>{output+=b});p.on('error',reject);p.on('exit',code=>done({code,output}))})
  const connection={host:'127.0.0.1',port:spec.dbPort,user:'postgres',password:'postgres',database:'postgres',application_name:spec.applicationName}
  let db,closed=false
  const close=async()=>{
    if(closed)return
    await db?.end().catch(()=>{})
    try{await owned.cleanup(async()=>{const r=await run(['stop','--project-id',projectId,'--no-backup']);assert.equal(r.code,0)});evidence.cleanup='PASS';closed=true}
    catch(e){evidence.cleanup='FAIL';throw e}finally{await persist()}
  }
  try{
    evidence.stage='BOOTSTRAP';await persist();console.log(JSON.stringify({suite,projectId,stage:evidence.stage}))
    const started=await run(['start','--exclude','realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'])
    await owned.capture();assert.equal(started.code,0,redactCommandOutput(started.output).slice(-1800));assert(!/Auto-fixing to/.test(started.output))
    for(const kind of ['db','auth','storage','kong','rest'])assert(owned.manifest.resources.containers.includes(`supabase_${kind}_${projectId}`))
    await assertCiOwnedConnection(connection,spec)
    db=new Client(connection);await db.connect()
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname IN('public','private')")).rows[0].n,0,'STACK_NOT_EMPTY')
    assert.equal((await db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,0)
    assert.equal((await db.query('SELECT count(*)::int n FROM storage.objects')).rows[0].n,0)
    evidence.fresh=true
    await db.query("SET statement_timeout='120s';SET lock_timeout='5s'")
    for(const kind of ['TABLES','SEQUENCES','FUNCTIONS'])await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM anon,authenticated,service_role`)
    const metadata={extensions:contract.extensions},installed=new Set((await db.query('SELECT extname FROM pg_extension')).rows.map(r=>r.extname))
    for(const e of metadata.extensions)if(!installed.has(e.name)){assert(['unaccent','pgcrypto','uuid-ossp','pg_cron','pg_net'].includes(e.name));await db.query(`CREATE EXTENSION ${ident(e.name)} WITH SCHEMA ${ident(e.schema)}`)}
    await db.query('SET search_path=public,extensions;SET row_security=on')
    for(const {entry,source} of sources){evidence.stage='APPLY:'+entry.version;if(entry.version==='20261005154435'&&atOriginal){evidence.applied.push(await atOriginal(db,source,evidence))}else{await db.query(source.sql);evidence.applied.push({version:entry.version,sha256:entry.sha256,source:source.evidence})}if(evidence.applied.length%50===0)console.log(JSON.stringify({suite,applied:evidence.applied.length}))}
    evidence.stage='CANONICAL_FIXTURE';evidence.fixture=await certifyCanonicalFixture(db)
    await db.query('CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions')
    const status=await run(['status','--output','json']);assert.equal(status.code,0)
    const local=JSON.parse(status.output.slice(status.output.indexOf('{'),status.output.lastIndexOf('}')+1));assertCiApi(local.API_URL,spec)
    const api=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
    evidence.stage='READY';await persist()
    return {db,connection,spec,api,local,evidence,persist,close,async capture(){await db.query("SET search_path=''");const rows=(await db.query(await read('scripts/qa/reconciliation/r1-9-target-catalog.sql'))).rows;await db.query('SET search_path=public,extensions');return rows.map(o=>({...o,hash:hash(JSON.stringify(o))}))}}
  }catch(e){evidence.result='FAIL';evidence.failure={code:e.code??'ASSERTION',message:redactCommandOutput(e.message),stage:evidence.stage};await close();throw e}
}
