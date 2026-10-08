import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import yaml from 'js-yaml'
import { assertPublicationConfig, branch } from './r1-19-publication-contract.mjs'

const files = {
  vercel: JSON.parse(await readFile('vercel.json', 'utf8')),
  certification: yaml.load(await readFile('.github/workflows/reconciliation-certification.yml', 'utf8')),
  standard: yaml.load(await readFile('.github/workflows/ci.yml', 'utf8')),
}
test('Real workflow routes cleanup and all ownership evidence; only this branch gains a Vercel block', () => {
  assert.equal(assertPublicationConfig(files).result, 'PASS')
  assert.equal(assertPublicationConfig(files).supabaseGitIntegration, 'REQUIRES_EXTERNAL_EVIDENCE')
})
test('Reject missing branch deploy block', () => {
  const f = structuredClone(files); delete f.vercel.git.deploymentEnabled[branch]
  assert.throws(() => assertPublicationConfig(f), /VERCEL_BRANCH_NOT_BLOCKED/)
})
test('Reject widening the block to other branches', () => {
  const f = structuredClone(files); f.vercel.git.deploymentEnabled['*'] = false
  assert.throws(() => assertPublicationConfig(f), /UNEXPECTED_BRANCH_POLICY_CHANGE/)
})
test('Reject old cleanup entrypoint', () => {
  const f = structuredClone(files)
  f.certification.jobs.sql.steps.find(s => s.name === 'Cleanup only manifest-owned resources').run = 'node scripts/qa/reconciliation/r1-18-ci-cleanup.mjs --local-only'
  assert.throws(() => assertPublicationConfig(f), /WRONG_CLEANUP_ENTRYPOINT/)
})
test('Reject omitted dedicated suite artifacts', () => {
  const f = structuredClone(files)
  const artifacts = f.certification.jobs.sql.steps.find(s => s.uses === 'actions/upload-artifact@v4')
  artifacts.with.path = artifacts.with.path.replace('rehearsal/reports/bw_email03_r110cnab_*-resources.json', '')
  assert.throws(() => assertPublicationConfig(f), /MISSING_OWNERSHIP_EVIDENCE/)
})
test('Reject real credentials in reconciliation workflow', () => {
  const f = structuredClone(files); f.certification.jobs.linux.env.SUPABASE_SERVICE_ROLE_KEY = '${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}'
  assert.throws(() => assertPublicationConfig(f), /REMOTE_SECRET_IN_CERTIFICATION/)
})
test('Reject a deploy step', () => {
  const f = structuredClone(files); f.certification.jobs.sql.steps.push({ run: 'supabase db push' })
  assert.throws(() => assertPublicationConfig(f), /DEPLOY_COMMAND_IN_CERTIFICATION/)
})
test('Reject real credentials in standard CI outside the excluded build step', () => {
  const f = structuredClone(files); f.standard.jobs.validate.steps.push({ run: 'npm test', env: { TOKEN: '${{ secrets.TOKEN }}' } })
  assert.throws(() => assertPublicationConfig(f), /REAL_SECRET_AVAILABLE_TO_RECONCILIATION/)
})

test('Reject removed Chrome preparation or relaxed PDF gate', () => {
  const f = structuredClone(files)
  f.certification.jobs.linux.steps = f.certification.jobs.linux.steps.filter(s => s.name !== 'Chrome infrastructure readiness')
  assert.throws(() => assertPublicationConfig(f), /CHROME_READINESS_ORDER/)
  const g = structuredClone(files)
  g.certification.jobs.linux.steps.find(s => s.name === 'Real PDF runtime')['continue-on-error'] = true
  assert.throws(() => assertPublicationConfig(g), /PDF_GATE_RELAXED/)
})
