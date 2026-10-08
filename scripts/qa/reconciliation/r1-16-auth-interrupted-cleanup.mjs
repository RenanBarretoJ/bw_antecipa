import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,sep} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {resumeDisposableResources,nativeSupabaseCli,inventory} from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2),['--local-only'])
const projectId='bw_email03_r110cred_1791410230676'
const dir='rehearsal/reports/',suite=JSON.parse(await readFile(dir+projectId+'-suite.json','utf8'))
assert.equal(suite.projectId,projectId);assert.equal(suite.stage,'BOOTSTRAP');assert.equal(suite.applied.length,0)
const owned=await resumeDisposableResources(dir+projectId+'-resources.json')
assert.equal(owned.manifest.projectId,projectId)
const root=resolve('rehearsal/tmp',projectId)
assert(root.startsWith(resolve('rehearsal/tmp')+sep+'bw_email03_'))
assert.deepEqual(owned.manifest.tempDirs,[root])
const exec=promisify(execFile),cli=await nativeSupabaseCli()
await owned.cleanup(async()=>{await exec(cli,['stop','--project-id',projectId,'--no-backup','--workdir',root],{windowsHide:true,timeout:60000})})
assert.deepEqual(await inventory(),owned.manifest.before,'PREEXISTING_DOCKER_CHANGED')
const report={at:new Date().toISOString(),result:'INTERRUPTED_INFRASTRUCTURE_RETRY',projectId,reason:'Controlled interrupt after about ten minutes preparing an unchanged fresh-stack retry; prior attempt failed Storage health checks',suiteSnapshot:suite,applicationMigrationsExecuted:0,applicationSqlTestsExecuted:0,cleanup:'PASS',preexistingDocker:'UNCHANGED',remoteWrites:0,originalEvidencePreserved:true}
await writeFile(dir+'R1_16_AUTH_RETRY_INTERRUPTED.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({result:report.result,cleanup:report.cleanup,applicationSqlTestsExecuted:0}))
