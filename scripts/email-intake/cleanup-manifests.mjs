import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { resumeDisposableResources, nativeSupabaseCli } from './disposable-resources.mjs'

// CI recovery also runs if the certification process was terminated before its finally block.
const exec = promisify(execFile), native = await nativeSupabaseCli()
for (const file of await readdir('rehearsal/reports').catch(() => [])) {
  if (!/^bw_email03_\d+-resources\.json$/.test(file)) continue
  const owned = await resumeDisposableResources(resolve('rehearsal/reports', file))
  assert.match(owned.manifest.projectId, /^bw_email03_\d+$/)
  const stop = async () => { await exec(native, ['stop', '--project-id', owned.manifest.projectId, '--no-backup'], { windowsHide: true, timeout: 60000 }) }
  await owned.cleanup(stop)
  await owned.cleanup(stop)
  console.log(JSON.stringify({ projectId: owned.manifest.projectId, cleanup: 'PASS', idempotent: 'PASS' }))
}
