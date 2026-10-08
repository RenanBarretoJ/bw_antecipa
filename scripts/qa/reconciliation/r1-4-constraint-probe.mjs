import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { configureDisposableToml,sanitizedLocalEnvironment,redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'
import { disposableResources,nativeSupabaseCli } from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const read=p=>readFile(p,'utf8')
const source=JSON.parse(await read('rehearsal/reports/R1_4_PROD_REMOTE_FIDELITY.json')).evidence
const snapshot=await read('rehearsal/tmp/reconciliation-r1-baselines/prod-schema.sql')
const projectId=`bw_email03_r14probe_${Date.now()}`,root=resolve('rehearsal/tmp',projectId)
await mkdir(resolve(root,'supabase/migrations'),{recursive:true})
await writeFile(resolve(root,'supabase/config.toml'),configureDisposableToml(await read('supabase/config.toml'),{projectId,apiPort:57841,dbPort:57842,shadowPort:57840,studioPort:57843,mailPort:57844,analyticsPort:57847}))
const owned=await disposableResources({projectId,file:`rehearsal/reports/${projectId}-resources.json`,tempDirs:[root]})
const cli=await nativeSupabaseCli(),env=sanitizedLocalEnvironment()
for(const k of Object.keys(env))if(/SUPABASE|DATABASE|POSTGRES|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI/i.test(k))delete env[k]
const run=args=>new Promise((done,reject)=>{const c=spawn(cli,[...args,'--workdir',root],{env,windowsHide:true});let output='';for(const s of [c.stdout,c.stderr])s.on('data',b=>{output+=b});c.on('error',reject);c.on('exit',code=>done({code,output}))})
const report={at:new Date().toISOString(),scope:'LOCAL_CONSTRAINT_DIAGNOSIS_NO_UPGRADES',projectId,constraints:[],cleanup:'NOT_RUN'}
let db
try{
  console.log(JSON.stringify({stage:'BOOTSTRAP_CONSTRAINT_PROBE',projectId}))
  const r=await run(['start','--exclude','realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);await owned.capture();assert.equal(r.code,0,redactCommandOutput(r.output).slice(-1500))
  db=new Client({host:'127.0.0.1',port:57842,user:'postgres',password:'postgres',database:'postgres'});await db.connect()
  report.settings=(await db.query("SELECT current_setting('server_version') version,current_setting('standard_conforming_strings') strings,current_setting('quote_all_identifiers') identifiers")).rows[0]
  for(const [index,c] of source.constraints.entries()){
    const snapshotLine=snapshot.split('\n').find(l=>l.includes('CONSTRAINT "'+c.name+'"'))?.trim().replace(/,$/,'')
    assert(snapshotLine)
    const variants=[]
    for(const [kind,definition] of [['remote',`CONSTRAINT "${c.name}" ${c.definition}`],['snapshot',snapshotLine]]){
      const table=`probe_${index}_${kind}`,column=c.columns[0].name
      await db.query(`CREATE TEMP TABLE ${table} (${column} text NOT NULL, ${definition})`)
      const row=(await db.query('SELECT pg_get_constraintdef(oid) definition,pg_get_expr(conbin,conrelid) expression,conbin::text tree,md5(pg_get_constraintdef(oid)) hash FROM pg_constraint WHERE conrelid=$1::regclass',[table])).rows[0]
      variants.push({kind,...row})
    }
    report.constraints.push({name:c.name,remote:c.definition,snapshotLine,variants})
  }
  report.result='DIAGNOSED'
}catch(e){report.result='FAIL';report.failure=redactCommandOutput(e.message).slice(0,2500);process.exitCode=1}
finally{await db?.end();try{await owned.cleanup(async()=>{assert.equal((await run(['stop','--project-id',projectId,'--no-backup'])).code,0)});report.cleanup='PASS'}catch(e){report.cleanup='FAIL';report.cleanupError=e.message;process.exitCode=1}
await writeFile('rehearsal/reports/R1_4_CONSTRAINT_PROBE.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))}
