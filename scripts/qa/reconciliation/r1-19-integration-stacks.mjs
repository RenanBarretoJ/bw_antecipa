import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { readFile, writeFile } from 'node:fs/promises'
import { freshStack } from './r1-10-fresh-stack.mjs'
import { stackSpec, assertR110OwnedConnection, assertLocalApi } from './r1-10-stack-guard.mjs'
import { applyR116 } from './r1-16-forwards.mjs'
import { applyAuthFix } from './r1-16-auth-forward.mjs'
import { docker, inventory } from '../../email-intake/disposable-resources.mjs'
import { hash } from './r1-4-restorer.mjs'

export const integrationSuites = Object.freeze([
  { suite: 'credential', file: 'integration_credential_first.sql' },
  { suite: 'inline', file: 'integration_inline_credentials.sql' },
  { suite: 'cnab', file: 'integration_activation_before_cnab.sql' },
].map(Object.freeze))

export function assertDedicatedSpec(suite, spec) {
  assert(integrationSuites.some(s => s.suite === suite), 'UNKNOWN_INTEGRATION_SUITE')
  assert.deepEqual(spec, stackSpec(suite, spec.projectId.split('_').at(-1)), 'DEDICATED_SUITE_CONTRACT_MISMATCH')
}

async function preflight(suite) {
  const expected = stackSpec(suite), before = await inventory(), ports = []
  const containers = before.containers.length ? JSON.parse(await docker(['inspect', ...before.containers])) : []
  for (const port of [expected.dbPort, expected.apiPort, expected.shadowPort, expected.studioPort, expected.mailPort, expected.analyticsPort]) {
    const owners = containers.filter(c => Object.values(c.HostConfig.PortBindings ?? {}).flatMap(x => x ?? []).some(b => Number(b.HostPort) === port)).map(c => c.Name.slice(1))
    assert.deepEqual(owners, [], 'DEDICATED_PORT_OWNED:' + port)
    await new Promise((done, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(e => e ? reject(e) : done()))
    })
    ports.push({ port, free: true, dockerOwners: owners })
  }
  const evidence = { at: new Date().toISOString(), suite, result: 'PASS', ports, before }
  await writeFile(`rehearsal/reports/R1_19_CI_${suite}_PREFLIGHT.json`, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  return evidence
}

export async function runDedicatedIntegrations(result, save) {
  for (const { suite, file } of integrationSuites) {
    const before = await preflight(suite)
    // Each suite gets a real fresh project, volume, network, Auth and canonical schema.
    // No SET application_name, SQL guard replacement or shared-connection relabeling.
    const dedicated = await freshStack(suite, result.stacks)
    const notices = [], listener = n => { if (/^PASS /.test(n.message)) notices.push(n.message) }
    try {
      assertDedicatedSpec(suite, dedicated.spec)
      await assertR110OwnedConnection(dedicated.connection, suite)
      assertLocalApi(dedicated.local.API_URL, dedicated.spec)
      assert.equal(dedicated.evidence.applied.length, 264); assert.equal(dedicated.evidence.excluded, 13)
      assert.equal(dedicated.evidence.fixture.certification.result, 'PASS')
      dedicated.evidence.preflight = before
      await applyR116(dedicated.db, dedicated.evidence)
      dedicated.evidence.authForward = await applyAuthFix(dedicated.db)
      const identity = (await dedicated.db.query("SELECT current_database() AS database,current_setting('application_name') AS application_name")).rows[0]
      assert.deepEqual(identity, { database: 'postgres', application_name: dedicated.spec.applicationName })
      const bytes = await readFile('supabase/tests/' + file)
      dedicated.db.on('notice', listener)
      try { await dedicated.db.query(bytes.toString('utf8').replace(/^\\set.*$/mg, '')); assert(notices.length > 0) }
      finally { await dedicated.db.query('ROLLBACK'); dedicated.db.off('notice', listener) }
      assert.equal((await dedicated.db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n, 0, 'FIXTURE_ROLLBACK_REQUIRED')
      result.sql.push({ file, scenarioGroups: notices.length, result: 'PASS', sha256: hash(bytes), suite,
        projectId: dedicated.spec.projectId, dbPort: dedicated.spec.dbPort, identity, notices, rollback: 'PASS' })
      dedicated.evidence.result = 'PASS'
    } catch (error) { dedicated.evidence.result = 'FAIL'; throw error }
    finally { await dedicated.close(); await save() }
    assert.deepEqual(await inventory(), before.before, 'DEDICATED_STACK_CLEANUP_DRIFT')
    console.log(JSON.stringify({ suite, scenarioGroups: notices.length, result: 'PASS', cleanup: 'PASS' }))
  }
}
