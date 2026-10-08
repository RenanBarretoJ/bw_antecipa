import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import yaml from 'js-yaml'
import { assertPublicationConfig, branch } from './r1-19-publication-contract.mjs'
import { verifyPreservation } from './r1-19-remote-preservation.mjs'
import { gitBytes } from './r1-5-migration-source.mjs'
import { hash } from './r1-4-restorer.mjs'

assert.deepEqual(process.argv.slice(2), ['--local-only'])
assert.equal(gitBytes(['branch', '--show-current']).toString().trim(), branch)
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const preserved = await verifyPreservation()
const config = {
  vercel: await json('vercel.json'),
  certification: yaml.load(await readFile('.github/workflows/reconciliation-certification.yml', 'utf8')),
  standard: yaml.load(await readFile('.github/workflows/ci.yml', 'utf8')),
}
const fileContracts = assertPublicationConfig(config)
const unitFiles = ['cleanup-lifecycle', 'integration-stacks', 'port-contract', 'publication-contract'].map(n => `scripts/qa/reconciliation/r1-19-${n}.test.mjs`)
const unit = spawnSync(process.execPath, ['--test', ...unitFiles], { encoding: 'utf8', windowsHide: true })
assert.equal(unit.status, 0, unit.stdout + unit.stderr)
assert.match(unit.stdout, /tests 52/)
const files = [...new Set([
  ...gitBytes(['diff', 'HEAD', '--name-only', '-z']).toString().split('\0'),
  ...gitBytes(['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0'),
])].filter(Boolean).sort()
const inventory = [], findings = [], forbiddenPaths = []
// Potential matches are recorded only by location, never by secret value.
const secretPatterns = [
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['supabase_token', /\b(?:sbp_[a-f0-9]{35,}|sb_secret_[A-Za-z0-9_-]{25,})\b/],
  ['openai_key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/],
  ['jwt_literal', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/],
  ['private_key_block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=]{40,}/],
]
for (const path of files) {
  if (/(^|\/)(?:\.env[^/]*|snapshots|node_modules|\.next)(\/|$)|\.(?:dump|backup|pem|pfx|pdf|zip|csv|xlsx)$/i.test(path) || path.startsWith('rehearsal/')) forbiddenPaths.push(path)
  const bytes = await readFile(path), text = bytes.toString('utf8')
  inventory.push({ path, sha256: hash(bytes), bytes: bytes.length })
  for (const [kind, pattern] of secretPatterns) {
    const match = pattern.exec(text)
    if (match) findings.push({ path, kind, line: text.slice(0, match.index).split('\n').length })
  }
}
assert.deepEqual(forbiddenPaths, [], 'FORBIDDEN_RELEASE_ARTIFACT')
assert.deepEqual(findings, [], 'POTENTIAL_SECRET_REQUIRES_REVIEW')
const contract = await json('scripts/qa/reconciliation/ci/contracts.json')
const forwards = [...contract.forwards.entries, contract.auth.entry]
assert.equal(forwards.length, 8)
for (const f of forwards) assert.equal(hash(await readFile(f.path)), f.sha256)
assert.equal(gitBytes(['diff', 'HEAD', '--name-only', '--diff-filter=MD', '--', 'supabase/migrations']).toString().trim(), '')
const sacado = 'supabase/migrations/20261005173648_sacado_rls_non_sacado_short_circuit.sql'
assert.equal(hash(await readFile(sacado)), '1006e35b48f871c4f14a72f7a3f2045b1f40c13f4bb80d7efeda0e26be8df3ac')
const prior = await json('rehearsal/reports/R1_19_CLEANUP_STATUS.json')
assert.equal(prior.result, 'LOCAL_PASS_STOPPED_BEFORE_PUBLICATION')
const at = new Date().toISOString()
const report = {
  at, result: 'LOCAL_CONFIGURATION_PASS_REMOTE_CI_BLOCKED', branch,
  fileContracts, preservation: preserved, unitTests: { passed: 52, failed: 0 },
  releaseInventory: inventory, automatedSecretScan: { result: 'PASS', files: files.length, findings, forbiddenPaths, limitation: 'Pattern scan is not a complete manual release review.' },
  forwards: forwards.map(({ path, sha256 }) => ({ path, sha256 })), historicalMigrationEdits: [],
  supabaseGitIntegration: 'UNKNOWN_REQUIRES_OPERATOR_CONFIRMATION',
  remoteBranchObserved: 'ABSENT_BEFORE_PUSH',
  githubHookInspection: 'HTTP_404_ADMIN_PERMISSION_UNAVAILABLE',
  sources: ['https://supabase.com/docs/guides/deployment/branching/github-integration', 'https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled'],
  commit: false, push: false, draftPr: false, remoteCi: 'NOT_RUN', merge: false, deploy: false,
  productionChanged: false, homologChanged: false, remoteSettingsChanged: false,
  readyForHomologRollout: false,
  nextStep: 'Confirm Automatic branching and Deploy to production state. If automatic branching is active, obtain a separately scoped safe isolation decision before publishing. Complete final release review before commit.',
}
await writeFile('rehearsal/reports/R1_19_PUBLICATION_PREFLIGHT.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ result: report.result, tests: report.unitTests, files: files.length, preservation: preserved.result, remoteCi: report.remoteCi }))
