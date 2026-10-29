import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import yaml from 'js-yaml'
import { analyzeManifest, canonicalHash, readMigrationSources, requiredPaths, excludedPaths, verifyProvenanceTable } from './s2-2s-manifest.mjs'
import { prepareAssets, nodeImage } from './s2-2s-ci-assets.mjs'
import { nativeImages } from '../vortx/main-native-images.mjs'
import { verifyProvenance, ciBranch, approvedBase } from './s2-2s-ci-provenance.mjs'

const manifest = JSON.parse(readFileSync(new URL('./s2-2s-selective-manifest.json', import.meta.url), 'utf8'))
const sources = await readMigrationSources()
const clone = value => structuredClone(value)

test('all ten provenance rows are explicit; exact bytes do not approve version equivalence', () => {
  const text = readFileSync(manifest.provenance.path, 'utf8')
  const table = JSON.parse(text)
  assert.equal(verifyProvenanceTable(manifest, table, text).rows, 10)
  assert.equal(table.rows.find(row => row.version === '20261023165316').versionEquivalenceApproved, false)
  assert.equal(table.rows.find(row => row.version === '20260928185439').classification, 'EXCEÇÃO HISTÓRICA DOCUMENTADA')
  const altered = clone(table); altered.rows.pop()
  assert.throws(() => verifyProvenanceTable(manifest, altered, text), /ALL_TEN/)
  const inferred = clone(table); inferred.rows.at(-1).versionEquivalenceApproved = true
  assert.throws(() => verifyProvenanceTable(manifest, inferred, text), /NO_AUTOMATIC_VERSION_EQUIVALENCE/)
})

test('all historical SQL is hash-frozen; exactly two operational migrations selected', () => {
  const report = analyzeManifest(manifest, sources)
  assert.equal(report.selectionVerified, true)
  assert.deepEqual(report.selected.map(item => item.path), requiredPaths)
  assert.deepEqual(report.excluded.map(item => item.path), excludedPaths)
  assert.equal(report.status, 'DRAFT_BLOCKED')
  assert.equal(report.applyAllowed, false)
  assert.equal(report.baseline.sourceAttestationComplete, false)
  assert.equal(report.baseline.missingVersions.length, 10)
  assert.equal(report.baseline.mappings.filter(item => item.exactLocalCandidates.length === 1).length, 1)
  assert.equal(report.databaseConnections, 0)
})
test('CRLF and LF match, but whitespace or SQL changes do not', () => {
  assert.equal(canonicalHash('a\r\nb\r\n'), canonicalHash('a\nb\n'))
  assert.notEqual(canonicalHash('a \n'), canonicalHash('a\n'))
  assert.equal(analyzeManifest(manifest, new Map([...sources].map(([path, text]) => [path, text.replace(/\r?\n/g, '\r\n')]))).selectionVerified, true)
})
for (const [name, mutate] of [
  ['pilot appended', doc => doc.required.push(doc.excluded[0])],
  ['pilot substituted', doc => { doc.required[0] = doc.excluded[0] }],
  ['order changed', doc => doc.required.reverse()],
  ['excluded missing', doc => { doc.excluded = [] }],
  ['source hash changed', doc => { doc.required[0].sha256 = '0'.repeat(64) }],
  ['path traversal', doc => { doc.required[0].path = '../secret.env' }],
  ['ledger hash missing', doc => { doc.baseline.versionInventorySha256 = null }],
  ['duplicate history', doc => doc.baseline.missingVersionEvidence.push(doc.baseline.missingVersionEvidence[0])],
]) test(`manifest rejects ${name}`, () => {
  const doc = clone(manifest); mutate(doc)
  assert.throws(() => analyzeManifest(doc, sources))
})
test('historical SQL mutation, missing and unexpected files fail closed', () => {
  const changed = new Map(sources)
  changed.set(requiredPaths[0], `${changed.get(requiredPaths[0])}\n-- changed`)
  assert.throws(() => analyzeManifest(manifest, changed), /DRIFT/)
  const missing = new Map(sources); missing.delete(requiredPaths[0])
  assert.throws(() => analyzeManifest(manifest, missing), /DRIFT/)
  const extra = new Map(sources); extra.set('supabase/migrations/999_extra.sql', 'select 1;')
  assert.throws(() => analyzeManifest(manifest, extra), /DRIFT/)
})

function provenanceFixture() {
  const event = { pull_request: { head: { ref: ciBranch, sha: 'a'.repeat(40), repo: { full_name: 'RenanBarretoJ/bw_antecipa' } },
    base: { ref: 'main', sha: approvedBase, repo: { full_name: 'RenanBarretoJ/bw_antecipa' } } } }
  const env = { nodeVersion: 'v22.23.4', sha: 'b'.repeat(40), eventName: 'pull_request' }
  const tree = 'c'.repeat(40)
  const git = (...args) => {
    if (args[0] === 'status') return ''
    if (args[0] === 'show') return JSON.stringify({ git: { deploymentEnabled: { [ciBranch]: false } } })
    return args[1] === 'HEAD' ? env.sha : tree
  }
  return { event, env, git }
}
test('merge ref with identical tree is not falsely reported as head SHA CI', () => {
  const { event, env, git } = provenanceFixture()
  const proof = verifyProvenance(event, env, git)
  assert.equal(proof.proof, 'MERGE_REF_WITH_IDENTICAL_HEAD_TREE')
  assert.notEqual(proof.executedSha, proof.headSha)
})
for (const [name, mutate] of [
  ['Node24', f => { f.env.nodeVersion = 'v24.1.0' }],
  ['fork', f => { f.event.pull_request.head.repo.full_name = 'other/fork' }],
  ['wrong branch', f => { f.event.pull_request.head.ref = 'main' }],
  ['base drift', f => { f.event.pull_request.base.sha = 'd'.repeat(40) }],
  ['non PR', f => { f.env.eventName = 'push' }],
  ['different tree', f => { const git = f.git; f.git = (...args) => args[1]?.startsWith('a') ? 'd'.repeat(40) : git(...args) }],
  ['dirty checkout', f => { const git = f.git; f.git = (...args) => args[0] === 'status' ? ' M file' : git(...args) }],
  ['deploy enabled', f => { const git = f.git; f.git = (...args) => args[0] === 'show' ? '{"git":{"deploymentEnabled":true}}' : git(...args) }],
]) test(`provenance rejects ${name}`, () => {
  const f = provenanceFixture(); mutate(f)
  assert.throws(() => verifyProvenance(f.event, f.env, f.git))
})

function imageRunner(calls, wrong = false) {
  return async args => {
    calls.push(args)
    if (args[0] !== 'image') return ''
    const image = [...nativeImages, nodeImage].find(item => item.alias === args[2] || item.source === args[2])
    return JSON.stringify([{ Id: 'sha256:synthetic', Os: 'linux', Architecture: 'amd64',
      RepoDigests: [`node@${wrong ? 'sha256:unexpected' : image.digest}`] }])
  }
}
test('existing-only image verification never pulls, tags, starts or removes resources', async () => {
  const calls = []
  assert.equal((await prepareAssets(imageRunner(calls), true)).images.length, 5)
  assert.ok(calls.every(args => args[0] === 'image' && args[1] === 'inspect'))
})
test('image digest drift is a hard failure', async () => {
  await assert.rejects(() => prepareAssets(imageRunner([], true), true), /IMAGE_DIGEST_MISMATCH/)
})
test('fresh CI pins all images before native provisioning', async () => {
  const calls = []
  await prepareAssets(imageRunner(calls), false)
  assert.equal(calls.filter(args => args[0] === 'pull').length, 5)
  assert.ok(calls.filter(args => args[0] === 'pull').every(args => args[1].includes('@sha256:')))
})

test('CI branch routing retains legacy jobs and isolates the SERPRO job', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8'))
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push'])
  assert.equal(workflow.jobs.validate.if, `github.head_ref != '${ciBranch}'`)
  const job = workflow.jobs.serpro_operational
  assert.equal(job.if, `github.event_name == 'pull_request' && github.head_ref == '${ciBranch}'`)
  assert.deepEqual(job.permissions, { contents: 'read' })
  assert.equal(job.env.SERPRO_NFE_CONSUMPTION_MODE, 'OFF_ZERO_BUDGET')
  for (const key of ['SERPRO_NFE_ENABLED', 'SERPRO_NFE_WORKER_ENABLED', 'SERPRO_NFE_QUERY_ENABLED', 'SERPRO_NFE_CONTRACT_VERIFIED']) assert.equal(job.env[key], 'false')
  assert.ok(!JSON.stringify(job).includes('secrets.'))
  assert.equal(job.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:1')
  assert.equal(job.steps[0].with['persist-credentials'], false)
  assert.equal(job.steps[1].with['node-version'], 22)
  for (const step of job.steps.filter(step => step.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/)
  const runs = job.steps.filter(step => step.run).map(step => step.run).join('\n')
  for (const command of ['s2-2s-ci-provenance.mjs --ci-only', 's2-2s-ci.test.mjs', 's2-2s-manifest.mjs --prepare-only',
    's2-2r-contained-qa.mjs --native-full', 'npx tsc --noEmit', 'npm run lint', 'npm run build -- --webpack']) assert.ok(runs.includes(command), command)
  assert.doesNotMatch(runs, /vercel |supabase (db |migration |link)|git push|curl |continue-on-error/)
  assert.ok(job.steps.slice(0, -1).every(step => !step.if && !step['continue-on-error']))
  assert.equal(job.steps.at(-1).if, 'always()')
  assert.doesNotMatch(job.steps.at(-1).with.path, /\.env|\.dump|\*\*\//)
})
