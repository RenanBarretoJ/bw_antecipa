// Separate independent runs, never relax the canonical single-root cleanup guard.
import assert from 'node:assert/strict'
import {readdir,readFile,writeFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {resumeDisposableResources,nativeSupabaseCli,inventory} from '../../email-intake/disposable-resources.mjs'
import {sanitizedLocalEnvironment} from '../../perf9e/clean-room-lib.mjs'
import {cleanupPlan,assertCompletedAbsent} from './r1-19-cleanup-lifecycle.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const exec=promisify(execFile),cli=await nativeSupabaseCli(),env=sanitizedLocalEnvironment()
for(const key of Object.keys(env))if(/SUPABASE|DATABASE|POSTGRES|EMAIL_INTAKE|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI/i.test(key))delete env[key]
const dir='rehearsal/reports/',files=(await readdir(dir)).filter(f=>/^bw_email03_r110pa_\d{13}-resources\.json$/.test(f))
const manifests=(await Promise.all(files.map(async f=>JSON.parse(await readFile(dir+f,'utf8'))))).filter(m=>m.runnerId==='R2_2_EXPLICIT_MAPPING')
const evidence=[]
// The runner creates independent stacks strictly sequentially and closes each before the next.
for(const m of manifests.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){
 const current=await inventory(),plan=cleanupPlan([m],current)
 assert.equal(plan.steps.length,1);assert.equal(plan.steps[0].projectId,m.projectId)
 const step=plan.steps[0]
 if(step.action==='VERIFY_COMPLETED_ABSENT')assertCompletedAbsent(m,current,await inventory('com.supabase.cli.project='+m.projectId))
 else{
  const owned=await resumeDisposableResources(dir+m.projectId+'-resources.json')
  await owned.cleanup(async()=>{await exec(cli,['stop','--project-id',m.projectId,'--no-backup'],{env,windowsHide:true,timeout:60000})})
 }
 assert.deepEqual(await inventory(),plan.baseline,'R22_RUN_BASELINE_NOT_PRESERVED')
 evidence.push({...step,result:'PASS'});console.log(JSON.stringify(evidence.at(-1)))
}
await writeFile(dir+'R2_2_CLEANUP_LIFECYCLE.json',JSON.stringify({result:'PASS',evidence,preexistingPreserved:true,canonicalGuardUnchanged:true},null,2)+'\n',{flag:'wx'})
