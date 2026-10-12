import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, readFile, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const exec = promisify(execFile)
export async function docker(args) {
  const { stdout } = await exec('docker', args, { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
  return stdout.trim()
}
export async function nativeSupabaseCli() {
  const suffix = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`
  const require = createRequire(import.meta.url)
  const bin = resolve(dirname(require.resolve(`@supabase/cli-${suffix}/package.json`)), 'bin', `supabase-go${process.platform === 'win32' ? '.exe' : ''}`)
  await access(bin)
  return bin
}
export async function inventory(filter = null) {
  const filtered = filter ? ['--filter', `label=${filter}`] : []
  const list = async args => (await docker(args)).split(/\r?\n/).filter(Boolean).sort()
  return {
    containers: await list(['ps', '-a', ...filtered, '--format', '{{.Names}}']),
    volumes: await list(['volume', 'ls', ...filtered, '--format', '{{.Name}}']),
    networks: await list(['network', 'ls', ...filtered, '--format', '{{.Name}}']),
  }
}

/** Ownership is established before creation and persisted before any destructive command. */
export async function disposableResources({ projectId, file, tempDirs = [], runnerId = null }) {
  assert.match(projectId, /^bw_email(?:03|05)_[a-z0-9_]*\d+$/)
  const label = `com.supabase.cli.project=${projectId}`
  const before = await inventory()
  const initial = await inventory(label)
  assert.ok(Object.values(initial).every(items => items.length === 0), 'DISPOSABLE_PROJECT_ALREADY_EXISTS')
  const manifest = { projectId, runnerId, tempDirs, before, resources: initial, cleanupRuns: [], createdAt: new Date().toISOString() }
  await writeFile(file, JSON.stringify(manifest, null, 2))
  return resourceTracker(manifest, file)
}

export async function resumeDisposableResources(file) {
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  assert.match(manifest.projectId, /^bw_email(?:03|05)_[a-z0-9_]*\d+$/)
  return resourceTracker(manifest, file)
}

function resourceTracker(manifest, file) {
  const { projectId, before } = manifest, label = `com.supabase.cli.project=${projectId}`
  for (const kind of ['containers', 'volumes', 'networks']) for (const name of manifest.resources[kind]) {
    assert.ok(name.endsWith(`_${projectId}`) && !before[kind].includes(name), 'REFUSE_UNOWNED_MANIFEST_RESOURCE')
  }
  const save = () => writeFile(file, JSON.stringify(manifest, null, 2))
  const capture = async () => {
    const current = await inventory(label)
    for (const kind of Object.keys(current)) {
      for (const name of current[kind]) {
        assert.ok(!before[kind].includes(name), 'REFUSE_PREEXISTING_RESOURCE')
        assert.ok(name.endsWith(`_${projectId}`), 'REFUSE_UNEXPECTED_RESOURCE_NAME')
      }
      manifest.resources[kind] = [...new Set([...manifest.resources[kind], ...current[kind]])].sort()
    }
    await save()
  }
  const postflight = async () => {
    const after = await inventory()
    for (const kind of Object.keys(after)) {
      assert.ok(manifest.resources[kind].every(name => !after[kind].includes(name)), `TEMPORARY_${kind.toUpperCase()}_REMAIN`)
      assert.ok(before[kind].every(name => after[kind].includes(name)), `PREEXISTING_${kind.toUpperCase()}_REMOVED`)
    }
    assert.ok(Object.values(await inventory(label)).every(items => !items.length), 'UNMANIFESTED_RESOURCE_REMAINS')
  }
  return { manifest, capture, postflight,
    async cleanup(stop) {
      await capture()
      const attempt = { at: new Date().toISOString(), result: 'IN_PROGRESS' }
      manifest.cleanupRuns.push(attempt); await save()
      try {
        let stopFailed = false
        try { await stop() } catch { stopFailed = true }
        // CLI versions can leave an exclusive empty network. Remove only recorded resources.
        const after = await inventory()
        const stillOwned = await inventory(label)
        for (const kind of ['containers', 'volumes', 'networks']) {
          const command = kind === 'containers' ? ['rm', '-f'] : [kind === 'volumes' ? 'volume' : 'network', 'rm']
          for (const name of manifest.resources[kind].filter(item => after[kind].includes(item))) {
            assert.ok(stillOwned[kind].includes(name), 'REFUSE_RESOURCE_WITH_CHANGED_OWNERSHIP')
            await docker([...command, name])
          }
        }
        await postflight()
        assert.equal(stopFailed, false, 'CLI_STOP_FAILED_RESOURCES_REMOVED_BY_MANIFEST')
        attempt.result = 'PASS'
      } catch (error) { attempt.result = 'FAIL'; throw error }
      finally { await save() }
    },
  }
}
