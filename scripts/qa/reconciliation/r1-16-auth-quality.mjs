import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {hash} from './r1-4-restorer.mjs'
import {sanitizedLocalEnvironment,redactCommandOutput} from '../../perf9e/clean-room-lib.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const dir='rehearsal/reports/'
for(const name of ['R1_16_AUTH_FULL_UPGRADES','R1_16_AUTH_CLEANROOM','R1_16_AUTH_EXTRA_SQL_SUITES','R1_16_AUTH_TARGET_CATALOG'])assert.equal(JSON.parse(await readFile(dir+name+'.json','utf8')).result,'PASS',name)
const report={at:new Date().toISOString(),result:'IN_PROGRESS',node:process.version,platform:process.platform,gates:[],remoteWrites:0}
const file=dir+'R1_16_AUTH_QUALITY_'+Date.now()+'.json'
const save=()=>writeFile(file,JSON.stringify(report,null,2)+'\n')
const env=sanitizedLocalEnvironment()
for(const k of Object.keys(env))if(/SUPABASE|DATABASE|POSTGRES|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI|CHROME/i.test(k))delete env[k]
Object.assign(env,{NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'ci-placeholder-anon-key',SUPABASE_SERVICE_ROLE_KEY:'ci-placeholder-service-role-key',PORTAL_FIDC_CREDENTIALS_JSON:'{}'})
try {
  assert.equal(process.versions.node.split('.')[0],'24','NODE24_REQUIRED')
  const pkg=JSON.parse(await readFile('package.json','utf8')),lock=JSON.parse(await readFile('package-lock.json','utf8'))
  for(const key of ['dependencies','devDependencies','engines'])assert.deepEqual(lock.packages[''][key],pkg[key],'LOCK_ROOT_DRIFT:'+key)
  report.package={result:'PASS_ROOT_CONTRACT',declaredEngine:pkg.engines.node,qaRuntime:process.version,engineChanged:false,packageHash:hash(await readFile('package.json')),lockHash:hash(await readFile('package-lock.json')),nextConfigHash:hash(await readFile('next.config.ts'))}
  const {default:sharp}=await import('sharp')
  const png=await sharp({create:{width:2,height:2,channels:4,background:'#0055cc'}}).png().toBuffer()
  assert.equal((await sharp(png).metadata()).width,2)
  report.sharp={result:'PASS',version:sharp.versions.sharp,bytes:png.length}
  for(const [name,args] of [
    ['typescript',['node_modules/typescript/bin/tsc','--noEmit','--incremental','false']],
    ['vitest',['node_modules/vitest/vitest.mjs','run','--pool=threads','--maxWorkers=1','--no-file-parallelism']],
    ['lint',['node_modules/eslint/bin/eslint.js','.']],
  ]){
    console.log(JSON.stringify({stage:name}))
    const started=Date.now()
    const r=await new Promise((done,reject)=>{const p=spawn(process.execPath,args,{env,windowsHide:true});let output='';for(const s of [p.stdout,p.stderr])s.on('data',b=>{output+=b});p.on('error',reject);p.on('exit',code=>done({code,output}))})
    const log=file.replace('.json','_'+name+'.log')
    await writeFile(log,redactCommandOutput(r.output),{flag:'wx'})
    report.gates.push({name,result:r.code===0?'PASS':'FAIL',exitCode:r.code,durationMs:Date.now()-started,log});await save()
    console.log(JSON.stringify(report.gates.at(-1)))
    assert.equal(r.code,0,'QUALITY_STOP:'+name)
  }
  report.result='PASS'
}catch(e){report.result='FAIL_STOPPED';report.failure={message:e.message,code:e.code};process.exitCode=1}
finally{await save()}
console.log(JSON.stringify({file,result:report.result,failure:report.failure}))
