import { mkdirSync,writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Does not apply migrations remotely, request provider data or modify the worktree.
// Keep global lint separate: an unrelated preexisting rehearsal/tmp artifact fails it.
const output=resolve(process.env.LOCALAPPDATA,'bw-antecipa-evidence/vortx-operational-reports-20261020',`quality-${Date.now()}`)
mkdirSync(output,{recursive:true})
const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'ci-placeholder-anon-key',
  SUPABASE_SERVICE_ROLE_KEY:'ci-placeholder-service-role-key',PORTAL_FIDC_CREDENTIALS_JSON:'{}',NEXT_TELEMETRY_DISABLED:'1',
  INTEGRATION_RUNTIME_ENV:'homologacao',NEXT_PUBLIC_APP_ENV:'homologacao'}
const commands=[
  ['typecheck',process.execPath,['node_modules/typescript/bin/tsc','--noEmit']],
  ['tests',process.execPath,['node_modules/vitest/vitest.mjs','run','--maxWorkers','2','--reporter=json',`--outputFile=${resolve(output,'vitest.json')}`]],
  ['callback_sql_two_stacks',process.execPath,['scripts/qa/vortx/callback-sql-rehearsal.mjs']],
  ['stock_sql_two_stacks',process.execPath,['scripts/qa/vortx/native-stock-sql-rehearsal.mjs']],
  ['preview_scope',process.execPath,['--test','scripts/qa/vortx/preview-scope.test.mjs']],
  ['lint_scoped',process.execPath,['node_modules/eslint/bin/eslint.js','src','scripts/qa/vortx']],
  ['lint_global',process.execPath,['node_modules/eslint/bin/eslint.js','.']],
  ['build',process.execPath,['node_modules/next/dist/bin/next','build','--webpack']],
  ['diff_check','git',['diff','--check']],
]
const checks=[]
for(const [name,command,args] of commands){
  const started=Date.now()
  const result=spawnSync(command,args,{env,encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:16*1024*1024})
  writeFileSync(resolve(output,`${name}.log`),(result.stdout??'')+'\n'+(result.stderr??''))
  checks.push({name,exitCode:result.status,error:result.error?.code??null,durationMs:Date.now()-started})
  writeFileSync(resolve(output,'QUALITY.json'),JSON.stringify({output,checks},null,2))
  console.log(JSON.stringify(checks.at(-1)))
  if(result.status!==0 && name!=='lint_global'){process.exitCode=1;break}
}
const complete=checks.length===commands.length
const globalLint=checks.find(c=>c.name==='lint_global')
const summary={output,complete,scopedPassed:complete&&checks.filter(c=>c.name!=='lint_global').every(c=>c.exitCode===0),
  globalLintPassed:globalLint?.exitCode===0,globalGatePassed:complete&&checks.every(c=>c.exitCode===0),
  REMOTE_CHANGED:false,PREVIEW_DEPLOYED:false}
writeFileSync(resolve(output,'SUMMARY.json'),JSON.stringify(summary,null,2))
console.log(JSON.stringify(summary))
if(!summary.globalGatePassed)process.exitCode=1
