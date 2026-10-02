import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { evidenceProjectId, evidenceReportName, evidenceCategory, archiveRunnerEvidence, verifyArchivedEvidence } from './runner-evidence.mjs'

test('evidence allowlist accepts only explicit harness IDs and file names', () => {
  for (const id of ['bw_email03_1790955208200', 'bw_email05_runner_1790955121360', 'bw_email05_cleanup_1790955121360']) {
    assert.equal(evidenceProjectId(id), true)
    assert.equal(evidenceReportName(`${id}-resources.json`), true)
  }
  for (const value of ['../', '/tmp/bw_email03_1', 'C:\\tmp\\bw_email03_1', 'unexpected_project',
    'spoof_bw_email03_1', 'bw_email03_1/../../file', 'bw_email03_1_extra', 'bw_email03_../1']) {
    assert.equal(evidenceProjectId(value), false)
    assert.equal(evidenceReportName(`${value}-resources.json`), false)
  }
  assert.equal(evidenceReportName('RLX_EMAIL_03_CLEAN_ROOM.secret.json'), false)
  assert.equal(evidenceReportName('.env.local'), false)
  for (const name of ['email05-r3-redaction-probe.json', 'email05-redaction.json', 'email05-ui.json', 'RLX_EMAIL_03_CLEAN_ROOM.json', 'runner-manifest.json', 'archive-summary.json']) {
    assert.equal(evidenceReportName(name), true, name)
  }
  assert.equal(evidenceCategory('runner-manifest.json'), 'RUNNER_MANIFEST')
  assert.equal(evidenceCategory('bw_email03_123-resources.json'), 'PROJECT_MANIFEST')
  assert.equal(evidenceCategory('email05-r3-redaction-probe.json'), 'REPORT_JSON')
  assert.equal(evidenceCategory('email05-r3-build.log'), 'LOG')
  assert.equal(evidenceCategory('screen-390.png'), 'SCREENSHOT')
  for (const name of ['email05-r3-redaction-probe.exe', 'spoof-email05-r3-redaction-probe.json', '/tmp/email05-ui.json']) assert.equal(evidenceCategory(name), 'UNKNOWN')
})

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'email05-evidence-'))
  try { await run(root) } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'email05-evidence-'))
    await rm(root, { recursive: true, force: true })
  }
}

test('child manifest, cleanup, UI and redaction survive removal of the disposable source', () => fixture(async root => {
  const source = join(root, 'source'), target = join(root, 'archive'), id = 'bw_email03_1790955208200'
  const reports = join(source, 'rehearsal/reports'), temp = join(source, 'rehearsal/tmp', id)
  await mkdir(reports, { recursive: true }); await mkdir(temp, { recursive: true })
  const files = [
    [`reports/${id}-resources.json`, JSON.stringify({ projectId: id, cleanupRuns: [{ result: 'PASS' }, { result: 'PASS' }] })],
    ['reports/RLX_EMAIL_03_CLEAN_ROOM.json', '{"cleanup":"PASS"}'],
    [`tmp/${id}/email05-redaction.json`, '{"summary":{"mustInspect":1},"rows":[]}'],
    [`tmp/${id}/email05-ui.json`, '{"result":"PASS"}'],
    ['reports/email05-r3-redaction-probe.json', '{"summary":{"mustInspect":3},"rows":[]}'],
    ['reports/runner-manifest.json', '{"cleanupRuns":[{"result":"PASS"}]}'],
  ]
  for (const [name, body] of files) await writeFile(join(source, 'rehearsal', name), body)
  await writeFile(join(reports, '.env.local'), 'PRIVATE_SENTINEL')
  const summary = await archiveRunnerEvidence(source, target, { requiredArtifacts: files.map(([name]) => name) })
  assert.equal(summary.copiedArtifacts.length, files.length)
  assert.equal(resolve(source), join(resolve(root), 'source'))
  await rm(source, { recursive: true, force: true })
  for (const [name, body] of files) assert.equal(await readFile(join(target, name), 'utf8'), body)
  assert.equal(JSON.parse(await readFile(join(target, 'archive-summary.json'), 'utf8')).result, 'PASS')
  await verifyArchivedEvidence(target)
  await assert.rejects(access(join(target, 'reports/.env.local')), { code: 'ENOENT' })
}))

test('archiving fails if a child exists without its resource manifest', () => fixture(async root => {
  await mkdir(join(root, 'source/rehearsal/tmp/bw_email03_123'), { recursive: true })
  await assert.rejects(archiveRunnerEvidence(join(root, 'source'), join(root, 'archive'), { requiredArtifacts: ['reports/bw_email03_123-resources.json'] }), /CHILD_MANIFEST_MISSING/)
}))

test('missing mandatory probe cannot become evidencePreserved; source remains', () => fixture(async root => {
  const source = join(root, 'source'), target = join(root, 'archive')
  await mkdir(join(source, 'rehearsal/reports'), { recursive: true })
  await assert.rejects(archiveRunnerEvidence(source, target, { requiredArtifacts: ['reports/email05-r3-redaction-probe.json'] }), /REQUIRED_ARTIFACTS_MISSING/)
  const summary = JSON.parse(await readFile(join(target, 'archive-summary.json'), 'utf8'))
  assert.equal(summary.result, 'FAIL'); assert.equal(summary.missingArtifacts.length, 1)
  await access(source)
  for (const path of ['../email05-ui.json', '/tmp/email05-ui.json', 'outside/email05-ui.json', 'reports/../email05-ui.json']) {
    await assert.rejects(archiveRunnerEvidence(source, target, { requiredArtifacts: [path] }), /INVALID_ARTIFACT_PATH|ARTIFACT_OUTSIDE_ALLOWED_DIRECTORY/)
  }
}))

test('archived corruption is rejected by post-delete hash verification', () => fixture(async root => {
  const source = join(root, 'source'), target = join(root, 'archive')
  await mkdir(join(source, 'rehearsal/reports'), { recursive: true })
  await writeFile(join(source, 'rehearsal/reports/email05-ui.json'), '{"result":"PASS"}')
  await archiveRunnerEvidence(source, target, { requiredArtifacts: ['reports/email05-ui.json'] })
  await writeFile(join(target, 'reports/email05-ui.json'), '{"result":"FAIL"}')
  await assert.rejects(verifyArchivedEvidence(target), /ARCHIVED_HASH_MISMATCH/)
}))
