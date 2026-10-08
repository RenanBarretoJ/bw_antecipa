import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import yaml from 'js-yaml'
import { assertPublicationConfig, branch } from './r1-19-publication-contract.mjs'
import { verifyPreservation, sourceFiles } from './r1-19-remote-preservation.mjs'
import { gitBytes } from './r1-5-migration-source.mjs'
import { hash } from './r1-4-restorer.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only', '--operator-confirmed-off'])
assert.equal(gitBytes(['branch', '--show-current']).toString().trim(), branch)
const read = async name => JSON.parse(await readFile('rehearsal/reports/' + name + '.json', 'utf8'))
const preflight = await read('R1_19_PUBLICATION_PREFLIGHT')
const preservation = await verifyPreservation()
const permittedConfigurationChanges = ['vercel.json', '.github/workflows/ci.yml', '.github/workflows/reconciliation-certification.yml']
const linux = await read('R1_19_LINUX_BUILD')
assert.equal(linux.result, 'PASS')
for (const file of linux.source.files) {
  if (!permittedConfigurationChanges.includes(file.path)) assert.equal(hash(await readFile(file.path)), file.sha256, 'CERTIFIED_SOURCE_CHANGED:' + file.path)
}
for (const file of preflight.releaseInventory) assert.equal(hash(await readFile(file.path)), file.sha256, 'RELEASE_PREFLIGHT_DRIFT:' + file.path)
const candidates = [...new Set([
  ...gitBytes(['diff', 'HEAD', '--name-only', '-z']).toString().split('\0'),
  ...gitBytes(['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0'),
])].filter(Boolean).sort()
const added = candidates.filter(p => !preflight.releaseInventory.some(f => f.path === p))
assert.deepEqual(added, ['scripts/qa/reconciliation/r1-19-release-gate.mjs'])
const inventory = []
for (const path of candidates) inventory.push({ path, sha256: hash(await readFile(path)) })
const config = {
  vercel: JSON.parse(await readFile('vercel.json', 'utf8')),
  certification: yaml.load(await readFile('.github/workflows/reconciliation-certification.yml', 'utf8')),
  standard: yaml.load(await readFile('.github/workflows/ci.yml', 'utf8')),
}
const publication = assertPublicationConfig(config)
const units = ['cleanup-lifecycle', 'integration-stacks', 'port-contract', 'publication-contract'].map(s => `scripts/qa/reconciliation/r1-19-${s}.test.mjs`)
const test = spawnSync(process.execPath, ['--test', ...units], { encoding: 'utf8', windowsHide: true })
assert.equal(test.status, 0, test.stdout + test.stderr); assert.match(test.stdout, /tests 52/)
const forwards = preflight.forwards
for (const file of forwards) assert.equal(hash(await readFile(file.path)), file.sha256)
assert.equal(gitBytes(['diff', 'HEAD', '--name-only', '--diff-filter=MD', '--', 'supabase/migrations']).toString().trim(), '')
gitBytes(['diff', '--check'])
const source = []
for (const path of sourceFiles()) source.push({ path, sha256: hash(await readFile(path)) })
const at = new Date().toISOString()
const report = {
  at, result: 'PASS_BEFORE_COMMIT', branch, headBefore: gitBytes(['rev-parse', 'HEAD']).toString().trim(),
  source, approvedCommitInventory: inventory, preservation, publication, unitTests: { passed: 52, failed: 0 },
  finalDiffReview: { result: 'PASS', historicalMigrationEdits: [], finalForwards: forwards,
    priorQualifiedSource: 'R1_19_LINUX_BUILD.json', priorQualifiedFilesVerified: linux.source.files.length,
    priorReleaseScan: 'R1_19_PUBLICATION_PREFLIGHT.json', additionalFileReviewed: added,
    rawSnapshotsIncluded: false, qaBusinessDatasetsIncluded: false, secretsFound: false,
    productionSchedulerActivation: false, guardsChanged: false, applicationChangedAfterCertification: false,
    scope: 'Previously certified reconciled application preserved by hash; complete candidate path inventory and safety-critical workflow/config/provenance delta reviewed.' },
  pushSafety: { result: 'PASS', classification: 'CI_ONLY',
    operatorEvidence: '2026-10-08 user Pronto and screenshot of RenanBarretoJ/bw_antecipa integration: Automatic branching OFF, Deploy to production OFF.',
    evidenceKind: 'USER_SCREENSHOT_CONFIRMATION_NOT_MANAGEMENT_API',
    vercel: 'Exact branch deploymentEnabled=false, with no matching true wildcard.',
    supabaseBranchBeforePush: 'Absent in current read-only list_branches response.',
    limits: 'Valid only while both Git integration options remain OFF. Do not re-enable automatic branching while this draft remains under certification without reviewing replay risk.' },
  remoteCi: 'NOT_RUN_YET', commit: false, push: false, deploy: false, merge: false, readyForHomologRollout: false,
}
await writeFile('rehearsal/reports/R1_19_RELEASE_GATE.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ result: report.result, files: inventory.length, tests: 52, pushSafety: report.pushSafety.classification }))
