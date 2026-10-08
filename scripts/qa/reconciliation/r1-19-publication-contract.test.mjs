import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import yaml from 'js-yaml'
import { assertPublicationConfig, branch, releaseBranch, certificationBranches } from './r1-19-publication-contract.mjs'

const files = {
  vercel: JSON.parse(await readFile('vercel.json', 'utf8')),
  certification: yaml.load(await readFile('.github/workflows/reconciliation-certification.yml', 'utf8')),
  standard: yaml.load(await readFile('.github/workflows/ci.yml', 'utf8')),
}
test('Real workflows preserve guards and block only the exact reconciliation/release Vercel branches', () => {
  assert.equal(assertPublicationConfig(files).result, 'PASS')
  assert.equal(assertPublicationConfig(files).supabaseGitIntegration, 'REQUIRES_EXTERNAL_EVIDENCE')
})
test('Reject missing branch deploy block', () => {
  const f = structuredClone(files); delete f.vercel.git.deploymentEnabled[branch]
  assert.throws(() => assertPublicationConfig(f), /VERCEL_BRANCH_NOT_BLOCKED/)
})
test('Reject missing release deploy block or overriding wildcard', () => {
  const f = structuredClone(files); delete f.vercel.git.deploymentEnabled[releaseBranch]
  assert.throws(() => assertPublicationConfig(f), /VERCEL_RELEASE_NOT_BLOCKED/)
  const g = structuredClone(files); g.vercel.git.deploymentEnabled['*'] = true
  assert.throws(() => assertPublicationConfig(g), /UNEXPECTED_BRANCH_POLICY_CHANGE/)
})
test('Reject missing homolog/release or broader certification push allowlist', () => {
  for (const missing of certificationBranches) {
    const f = structuredClone(files)
    f.certification.on.push.branches = f.certification.on.push.branches.filter(b => b !== missing)
    assert.throws(() => assertPublicationConfig(f), /CERTIFICATION_BRANCH_ALLOWLIST/)
  }
  for (const added of ['main', 'release/**', '*']) {
    const f = structuredClone(files); f.certification.on.push.branches.push(added)
    assert.throws(() => assertPublicationConfig(f), /CERTIFICATION_BRANCH_ALLOWLIST/)
  }
})
test('Reject missing release standard CI and broadened certification job conditions', () => {
  const f = structuredClone(files)
  f.standard.on.push.branches = f.standard.on.push.branches.filter(b => b !== releaseBranch)
  assert.throws(() => assertPublicationConfig(f), /STANDARD_BRANCH_ALLOWLIST/)
  for (const name of ['linux', 'sql']) {
    const g = structuredClone(files); g.certification.jobs[name].if = 'true'
    assert.throws(() => assertPublicationConfig(g), /CERTIFICATION_JOB_ALLOWLIST/)
  }
})
test('Reject standard build exposing secrets to homolog/release or skipping placeholders', () => {
  const f = structuredClone(files)
  f.standard.jobs.validate.steps.find(s => s.name === 'Build').if = `github.head_ref != '${branch}' && github.ref != 'refs/heads/${branch}'`
  assert.throws(() => assertPublicationConfig(f), /STANDARD_SECRET_ISOLATION/)
  const g = structuredClone(files)
  g.standard.jobs.validate.steps.find(s => s.name === 'Reconciliation build (isolated placeholders)').if = 'false'
  assert.throws(() => assertPublicationConfig(g), /STANDARD_PLACEHOLDER_ALLOWLIST/)
})

// Interpret only the comparison/AND/OR grammar used by these branch guards.
function matches(expression, context) {
  return expression.split(' || ').some(group => group.split(' && ').every(term => {
    const match = /^github\.(head_ref|ref) (==|!=) '([^']+)'$/.exec(term)
    assert(match, 'Unexpected workflow condition grammar')
    const equal = context[match[1]] === match[3]
    return match[2] === '==' ? equal : !equal
  }))
}
test('Push and PR routing: exact three branches isolated; main and unrelated branches excluded', () => {
  const steps = files.standard.jobs.validate.steps
  const real = steps.find(s => s.name === 'Build').if
  const isolated = steps.find(s => s.name === 'Reconciliation build (isolated placeholders)').if
  for (const candidate of [...certificationBranches, 'main', 'master', 'release/unrelated', `${releaseBranch}-extra`, 'feature/unrelated']) {
    const expected = certificationBranches.includes(candidate)
    for (const context of [{ ref: `refs/heads/${candidate}`, head_ref: '' }, { ref: 'refs/pull/97/merge', head_ref: candidate }]) {
      assert.equal(matches(isolated, context), expected, JSON.stringify(context))
      assert.equal(matches(real, context), !expected, JSON.stringify(context))
      for (const job of Object.values(files.certification.jobs)) assert.equal(matches(job.if, context), expected, JSON.stringify(context))
    }
  }
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
