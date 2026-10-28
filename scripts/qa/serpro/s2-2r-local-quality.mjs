import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { delimiter, dirname, resolve } from 'node:path'

assert.ok(process.version.startsWith('v22.'), 'NODE22_REQUIRED')
const root = resolve(process.env.LOCALAPPDATA, 'bw-antecipa-evidence', 's2-2r-local-20261028', `quality-${Date.now()}`)
await mkdir(root, { recursive:true })
const report = { runtime:process.version, tests:{}, externalProviderCalls:0, remoteMutations:false, result:'IN_PROGRESS' }
const env = { ...process.env, PATH:dirname(process.execPath)+delimiter+process.env.PATH,
  SERPRO_NFE_WORKER_ENABLED:'false',SERPRO_NFE_QUERY_ENABLED:'false',SERPRO_NFE_CONTRACT_VERIFIED:'false',
  SERPRO_NFE_CONSUMPTION_MODE:'OFF_ZERO_BUDGET',SERPRO_NFE_CONSUMER_KEY:'',SERPRO_NFE_CONSUMER_SECRET:'',
  NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:1',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-build-anon',
  SUPABASE_SERVICE_ROLE_KEY:'synthetic-build-service',NEXT_TELEMETRY_DISABLED:'1' }
async function run(label, program, args, timeout=600000) {
  console.log(label)
  const result = await new Promise((done,reject)=>{
    const child=spawn(program,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']})
    const data=[],stderr=[];const timer=setTimeout(()=>child.kill('SIGTERM'),timeout)
    child.stdout.on('data',b=>data.push(b));child.stderr.on('data',b=>stderr.push(b))
    child.on('error',error=>{clearTimeout(timer);reject(error)})
    child.on('close',code=>{clearTimeout(timer);done({code,output:Buffer.concat(data).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')})})
  })
  await writeFile(resolve(root,label+'.log'),result.output+result.stderr)
  report.tests[label]={exitCode:result.code,status:result.code===0?'PASS':'FAIL'}
  await writeFile(resolve(root,'report.json'),JSON.stringify(report,null,2))
  assert.equal(result.code,0,label+'_FAILED')
  return result.output.trim()
}
try {
  const base='e55b3baa57dd2a8ffbf573f1763669fd6c0a8a2b'
  report.base=await run('base','git',['rev-parse','HEAD']);assert.equal(report.base,base,'HEAD_DRIFT')
  report.branch=await run('branch','git',['branch','--show-current'])
  assert.equal(report.branch,'feature/s2-1a4h-serpro-audit-budget-local-20261028','BRANCH_DRIFT')
  const tracked=await run('tracked','git',['diff','--name-only'])
  const untracked=await run('untracked','git',['ls-files','--others','--exclude-standard'])
  report.files=await Promise.all([...new Set((tracked+'\n'+untracked).split(/\r?\n/).filter(Boolean))].sort().map(async path=>{
    const bytes=await readFile(path);const canonical=bytes.toString('utf8').replace(/\r\n/g,'\n')
    return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),canonicalLfSha256:createHash('sha256').update(canonical).digest('hex')}
  }))
  await run('diff-check','git',['diff','--check'])
  await run('focused',process.execPath,['node_modules/vitest/vitest.mjs','run','src/lib/serpro-nfe','src/lib/actions/situacao-fiscal-nfe.test.ts','src/app/api/cron/serpro-nfe',
    '--pool=threads','--maxWorkers=1','--no-file-parallelism','--reporter=json',`--outputFile=${resolve(root,'focused.json')}`])
  await run('typescript',process.execPath,['node_modules/typescript/bin/tsc','--noEmit'])
  await run('eslint',process.execPath,['node_modules/eslint/bin/eslint.js','.'])
  await run('build-node22-webpack',process.execPath,['node_modules/next/dist/bin/next','build','--webpack'])
  for (const file of report.files) {
    const canonical=(await readFile(file.path,'utf8')).replace(/\r\n/g,'\n')
    assert.equal(createHash('sha256').update(canonical).digest('hex'),file.canonicalLfSha256,'SOURCE_DRIFT_DURING_QUALITY:'+file.path)
  }
  report.result='PASS'
} catch(error) { report.result='PARTIAL_STOP';report.error=error.message;process.exitCode=1 }
finally { report.finishedAt=new Date().toISOString();await writeFile(resolve(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,report:resolve(root,'report.json')})) }
