import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { readFile, writeFile } from 'node:fs/promises'
import { docker, inventory } from '../../email-intake/disposable-resources.mjs'

export function ciSpec(dbPort, nonce = Date.now()) {
  assert([57842, 57942].includes(dbPort), 'LOCAL_REHEARSAL_PORT_REQUIRED')
  assert.match(String(nonce), /^\d{13}$/)
  // Keep the established CI cleanup/artifact namespace; all IDs are fresh.
  return { suite: 'ci', projectId: `bw_email03_r110pa_${nonce}`, dbPort, apiPort: dbPort - 1,
    shadowPort: dbPort - 2, studioPort: dbPort + 1, mailPort: dbPort + 2,
    analyticsPort: dbPort + 5, applicationName: `r119_ci_${nonce}` }
}
export function assertCiConnection(connection, spec) {
  assert.deepEqual(spec, ciSpec(spec.dbPort, spec.projectId.split('_').at(-1)))
  assert.equal(connection.host, '127.0.0.1')
  assert.equal(connection.port, spec.dbPort)
  assert.equal(connection.user, 'postgres'); assert.equal(connection.database, 'postgres')
  assert.equal(connection.application_name, spec.applicationName)
}
export function assertCiApi(url, spec) {
  assert.equal(url, `http://127.0.0.1:${spec.apiPort}`)
}
export function chooseSpec(candidates) {
  const candidate = candidates.find(c => c.probes.every(p => p.free && !p.dockerOwners.length))
  assert(candidate, 'NO_SAFE_ALLOWED_PORT_AVAILABLE')
  return candidate.spec
}
export async function portPreflight(nonce = Date.now()) {
  const before = await inventory()
  const containers = before.containers.length ? JSON.parse(await docker(['inspect', ...before.containers])) : []
  const candidates = []
  for (const port of [57842, 57942]) {
    const spec = ciSpec(port, nonce), probes = []
    for (const value of [spec.dbPort, spec.apiPort, spec.shadowPort, spec.studioPort, spec.mailPort, spec.analyticsPort]) {
      const dockerOwners = containers.filter(c => Object.values(c.HostConfig.PortBindings ?? {}).flatMap(x => x ?? []).some(b => Number(b.HostPort) === value)).map(c => c.Name.slice(1))
      const free = await new Promise((done, reject) => {
        const server = createServer()
        server.once('error', e => e.code === 'EADDRINUSE' ? done(false) : reject(e))
        server.listen({ host: '127.0.0.1', port: value, exclusive: true }, () => server.close(e => e ? reject(e) : done(true)))
      })
      probes.push({ port: value, free, dockerOwners })
    }
    candidates.push({ spec, probes })
  }
  const spec = chooseSpec(candidates)
  for (const names of Object.values(before)) assert(!names.some(n => n.endsWith('_' + spec.projectId)), 'PREEXISTING_PROJECT_ID')
  return { at: new Date().toISOString(), result: 'PASS', spec, candidates, before }
}
export async function recordPortOwnership(owned, preflight, file) {
  assert.equal(owned.manifest.projectId, preflight.spec.projectId)
  assert.deepEqual(owned.manifest.before, preflight.before)
  assert(Object.values(owned.manifest.resources).every(x => x.length === 0))
  owned.manifest.portContract = preflight
  await writeFile(file, JSON.stringify(owned.manifest, null, 2) + '\n')
}
export async function assertCiOwnedConnection(connection, spec) {
  assertCiConnection(connection, spec)
  const manifest = JSON.parse(await readFile(`rehearsal/reports/${spec.projectId}-resources.json`, 'utf8'))
  assert.equal(manifest.projectId, spec.projectId)
  assert.deepEqual(manifest.portContract.spec, spec)
  const resources = await inventory(`com.supabase.cli.project=${spec.projectId}`)
  for (const kind of ['containers', 'volumes', 'networks']) {
    assert(resources[kind].length > 0, 'MISSING_OWNED_' + kind)
    for (const name of resources[kind]) {
      assert(manifest.resources[kind].includes(name)); assert(!manifest.before[kind].includes(name))
      assert(name.endsWith('_' + spec.projectId))
    }
  }
  for (const [kind, internal, external] of [['db', '5432/tcp', spec.dbPort], ['kong', '8000/tcp', spec.apiPort]]) {
    const name = `supabase_${kind}_${spec.projectId}`
    assert.equal(await docker(['inspect', '--format', '{{index .Config.Labels "com.supabase.cli.project"}}', name]), spec.projectId)
    const bindings = (await docker(['port', name, internal])).split(/\r?\n/)
    assert(bindings.length > 0 && bindings.every(b => b.endsWith(':' + external)), 'OWNED_PORT_MISMATCH')
  }
}
