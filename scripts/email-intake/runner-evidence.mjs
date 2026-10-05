import assert from 'node:assert/strict'
import { readdir, cp, mkdir, readFile, writeFile, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, relative, basename, sep } from 'node:path'

export function evidenceProjectId(value) {
  return /^bw_email(?:03_\d+|05_(?:runner|cleanup)_\d+)$/.test(value)
}

export function evidenceCategory(value) {
  if (/[\\/]/.test(value)) return 'UNKNOWN'
  if (value === 'runner-manifest.json') return 'RUNNER_MANIFEST'
  if (value === 'archive-summary.json') return 'REPORT_JSON'
  if (/^email05-r10-finalization-(?:probe|case-(?:[0-9]|1[0-9]))\.json$/.test(value)) return 'REPORT_JSON'
  if (value === 'email05-r8-no-body-probe.json') return 'REPORT_JSON'
  if (/^(?:email05-(?:network|ui|redaction|body-failures|log-redaction)|email-browser-build|clean-room-checkpoint|shared-result)\.json$/.test(value)) return 'REPORT_JSON'
  if (/^(?:RLX_EMAIL_03_CLEAN_ROOM(?:_bw_email03_\d+)?|email05-r[345]-[a-z-]+)\.json$/.test(value)) return 'REPORT_JSON'
  if (/^(?:RLX_EMAIL_03_SHARED_bw_email03_\d+|email05-r[345]-[a-z-]+|email-browser-build)\.log$/.test(value) || value === 'email-browser-build-attempts.jsonl') return 'LOG'
  const resource = /^(.*)-(?:resources|manifest|probe)\.json$/.exec(value)
  if (resource && evidenceProjectId(resource[1])) return value.endsWith('-probe.json') ? 'REPORT_JSON' : 'PROJECT_MANIFEST'
  if (/^[a-z0-9-]+\.png$/.test(value)) return 'SCREENSHOT'
  return 'UNKNOWN'
}

export function evidenceReportName(value) {
  return ['PROJECT_MANIFEST', 'RUNNER_MANIFEST', 'REPORT_JSON', 'LOG'].includes(evidenceCategory(value))
}

function artifactPath(base, value) {
  assert.ok(typeof value === 'string' && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..'), 'INVALID_ARTIFACT_PATH')
  const allowed = /^reports\/[^/]+$/.test(value) ? evidenceReportName(basename(value))
    : /^tmp\/bw_email03_\d+\/[^/]+$/.test(value) ? evidenceReportName(basename(value))
    : /^tmp\/bw_email03_\d+\/email05-screenshots\/[a-z0-9-]+\.png$/.test(value)
  assert.ok(allowed, 'ARTIFACT_OUTSIDE_ALLOWED_DIRECTORY')
  const target = resolve(base, value)
  assert.ok(target.startsWith(resolve(base) + sep), 'ARTIFACT_OUTSIDE_ALLOWED_DIRECTORY')
  return target
}

function validateStructure(path, bytes) {
  if (!path.endsWith('.json')) return
  const parsed = JSON.parse(bytes.toString('utf8'))
  assert.ok(parsed && typeof parsed === 'object', 'INVALID_EVIDENCE_JSON')
  if (/redaction(?:-probe)?\.json$/.test(path) && !path.endsWith('log-redaction.json')) {
    assert.ok(Array.isArray(parsed.rows) && typeof parsed.summary?.mustInspect === 'number', 'INVALID_REDACTION_EVIDENCE')
  }
}

export async function verifyArchivedEvidence(destination) {
  const summary = JSON.parse(await readFile(resolve(destination, 'archive-summary.json'), 'utf8'))
  assert.equal(summary.result, 'PASS', 'ARCHIVE_NOT_COMPLETE')
  assert.ok(summary.requiredArtifacts.length > 0 && summary.missingArtifacts.length === 0, 'REQUIRED_ARTIFACTS_MISSING')
  for (const path of summary.requiredArtifacts) assert.ok(summary.copiedArtifacts.includes(path), 'REQUIRED_ARTIFACT_NOT_COPIED')
  for (const row of summary.hashVerifiedArtifacts) {
    const bytes = await readFile(artifactPath(destination, row.path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, 'ARCHIVED_HASH_MISMATCH')
    validateStructure(row.path, bytes)
  }
  assert.deepEqual(summary.hashVerifiedArtifacts.map(row => row.path), summary.copiedArtifacts, 'ARCHIVE_HASH_COVERAGE_MISSING')
  return summary
}

/** Archive only reviewed diagnostics; never copy local configs, CLI secrets or HTTP fixtures. */
export async function archiveRunnerEvidence(root, destination, { requiredArtifacts, requireOperatorArtifacts = false } = {}) {
  assert.ok(Array.isArray(requiredArtifacts) && requiredArtifacts.length > 0, 'REQUIRED_ARTIFACTS_NOT_DEFINED')
  for (const path of requiredArtifacts) artifactPath(destination, path)
  const required = new Set(requiredArtifacts)
  const reports = resolve(root, 'rehearsal/reports')
  const copied = [], reportNames = await readdir(reports).catch(() => [])
  const copy = async (from, to) => {
    assert.ok((await lstat(from)).isFile(), 'EVIDENCE_MUST_BE_REGULAR_FILE')
    await mkdir(resolve(to, '..'), { recursive: true }); await cp(from, to)
    const bytes = await readFile(from), archived = await readFile(to)
    assert.ok(bytes.equals(archived), 'EVIDENCE_COPY_MISMATCH')
    validateStructure(to, archived)
    copied.push({ path: relative(destination, to).replaceAll('\\', '/'), sha256: createHash('sha256').update(archived).digest('hex') })
  }
  for (const name of reportNames) if (evidenceReportName(name)) await copy(resolve(reports, name), resolve(destination, 'reports', name))
  const tmp = resolve(root, 'rehearsal/tmp')
  const diagnosticPattern = /^(?:email05-(?:network|ui|redaction|body-failures|log-redaction)\.json|email-browser-build\.(?:json|log)|email-browser-build-attempts\.jsonl|clean-room-checkpoint\.json|shared-result\.json)$/
  for (const project of await readdir(tmp).catch(() => [])) {
    if (!/^bw_email03_\d+$/.test(project)) continue
    assert.ok((await lstat(resolve(tmp, project))).isDirectory(), 'EVIDENCE_PROJECT_MUST_BE_DIRECTORY')
    assert.ok(reportNames.includes(`${project}-resources.json`), 'CHILD_MANIFEST_MISSING')
    required.add(`reports/${project}-resources.json`)
    if (requireOperatorArtifacts) {
      required.add('reports/RLX_EMAIL_03_CLEAN_ROOM.json')
      for (const file of ['email05-ui.json', 'email05-redaction.json', 'email05-network.json', 'email05-log-redaction.json']) required.add(`tmp/${project}/${file}`)
    }
    for (const name of await readdir(resolve(tmp, project))) {
      if (diagnosticPattern.test(name)) await copy(resolve(tmp, project, name), resolve(destination, 'tmp', project, name))
      if (name === 'email05-screenshots') for (const screenshot of await readdir(resolve(tmp, project, name))) {
        if (/^[a-z0-9-]+\.png$/.test(screenshot)) await copy(resolve(tmp, project, name, screenshot), resolve(destination, 'tmp', project, name, screenshot))
      }
    }
  }
  await mkdir(destination, { recursive: true })
  const copiedArtifacts = copied.map(row => row.path)
  const missingArtifacts = [...required].filter(path => !copiedArtifacts.includes(path))
  const summary = { result: missingArtifacts.length ? 'FAIL' : 'PASS', requiredArtifacts: [...required], copiedArtifacts, missingArtifacts, hashVerifiedArtifacts: copied }
  await writeFile(resolve(destination, 'archive-summary.json'), JSON.stringify(summary, null, 2))
  assert.equal(missingArtifacts.length, 0, 'REQUIRED_ARTIFACTS_MISSING')
  return verifyArchivedEvidence(destination)
}
