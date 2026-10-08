import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resumeDisposableResources, nativeSupabaseCli } from '../../email-intake/disposable-resources.mjs'
assert.deepEqual(process.argv.slice(2), ['--local-only'])
const exec = promisify(execFile), cli = await nativeSupabaseCli()
for (const file of await readdir('rehearsal/reports').catch(() => [])) {
  if (!/^bw_email03_r110pa_\d+-resources\.json$/.test(file)) continue
  const owned = await resumeDisposableResources('rehearsal/reports/' + file)
  assert.match(owned.manifest.projectId, /^bw_email03_r110pa_\d+$/)
  await owned.cleanup(async () => { await exec(cli, ['stop', '--project-id', owned.manifest.projectId, '--no-backup'], { windowsHide: true, timeout: 60000 }) })
  console.log(JSON.stringify({ projectId: owned.manifest.projectId, cleanup: 'PASS' }))
}
