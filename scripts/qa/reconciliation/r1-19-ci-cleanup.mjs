import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resumeDisposableResources, nativeSupabaseCli, inventory } from '../../email-intake/disposable-resources.mjs'
import { sanitizedLocalEnvironment } from '../../perf9e/clean-room-lib.mjs'
import { cleanupPlan, assertCompletedAbsent } from './r1-19-cleanup-lifecycle.mjs'
assert.deepEqual(process.argv.slice(2), ['--local-only'])
const exec = promisify(execFile), cli = await nativeSupabaseCli(), env = sanitizedLocalEnvironment()
for (const key of Object.keys(env)) if (/SUPABASE|DATABASE|POSTGRES|EMAIL_INTAKE|SECRET|PASSWORD|TOKEN|CREDENTIAL|OPENAI/i.test(key)) delete env[key]
const files = (await readdir('rehearsal/reports')).filter(file => /^bw_email03_r110(pa|cred|inl|cnab)_\d+-resources\.json$/.test(file))
const manifests = await Promise.all(files.map(file => readFile('rehearsal/reports/' + file, 'utf8').then(JSON.parse)))
const plan = cleanupPlan(manifests, await inventory()), evidence = []
for (const step of plan.steps) {
  const file = `rehearsal/reports/${step.projectId}-resources.json`
  const manifest = manifests.find(m => m.projectId === step.projectId)
  if (step.action === 'VERIFY_COMPLETED_ABSENT') {
    // Finished lifecycle: read-only verification, never invoke a second stop/postflight.
    assertCompletedAbsent(manifest, await inventory(), await inventory('com.supabase.cli.project=' + step.projectId))
  } else {
    const owned = await resumeDisposableResources(file)
    await owned.cleanup(async () => { await exec(cli, ['stop', '--project-id', step.projectId, '--no-backup'], { env, windowsHide: true, timeout: 60000 }) })
  }
  evidence.push({ ...step, result: 'PASS' })
  console.log(JSON.stringify(evidence.at(-1)))
}
assert.deepEqual(await inventory(), plan.baseline, 'RUN_BASELINE_NOT_PRESERVED')
await writeFile('rehearsal/reports/R1_19_CLEANUP_LIFECYCLE.json', JSON.stringify({ at: new Date().toISOString(), result: 'PASS', evidence, preexistingPreserved: true }, null, 2) + '\n', { flag: 'wx' })
