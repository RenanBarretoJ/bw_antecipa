import assert from 'node:assert/strict'

export const branch = 'reconcile/main-homolog-2026-10-06'
export const releaseBranch = 'release/homolog-reconciliation-2026-10-08'
export const certificationBranches = [branch, releaseBranch, 'homolog']
export const branchCondition = certificationBranches.map(b => `github.head_ref == '${b}' || github.ref == 'refs/heads/${b}'`).join(' || ')
const jobCondition = certificationBranches.map(b => `github.ref == 'refs/heads/${b}' || github.head_ref == '${b}'`).join(' || ')
const inverseCondition = certificationBranches.map(b => `github.head_ref != '${b}' && github.ref != 'refs/heads/${b}'`).join(' && ')

// File-level proof only. Supabase Git integration still needs independent live evidence.
export function assertPublicationConfig({ vercel, certification, standard }) {
  assert.equal(vercel.git.deploymentEnabled[branch], false, 'VERCEL_BRANCH_NOT_BLOCKED')
  assert.equal(vercel.git.deploymentEnabled[releaseBranch], false, 'VERCEL_RELEASE_NOT_BLOCKED')
  assert.equal(vercel.git.deploymentEnabled['validation/rlx-email04-linux'], false)
  assert.deepEqual(Object.keys(vercel.git.deploymentEnabled).sort(), [branch, releaseBranch, 'validation/rlx-email04-linux'].sort(), 'UNEXPECTED_BRANCH_POLICY_CHANGE')
  assert.deepEqual(certification.permissions, { contents: 'read' })
  assert.deepEqual(certification.on.push.branches, certificationBranches, 'CERTIFICATION_BRANCH_ALLOWLIST')
  assert.deepEqual(standard.on.push.branches, ['homolog', 'main', 'master', releaseBranch], 'STANDARD_BRANCH_ALLOWLIST')
  assert.equal(certification.concurrency['cancel-in-progress'], false)
  assert.deepEqual(Object.keys(certification.jobs).sort(), ['linux', 'sql'])
  for (const job of Object.values(certification.jobs)) {
    assert.equal(job.if, jobCondition, 'CERTIFICATION_JOB_ALLOWLIST')
    assert.equal(job.steps.find(s => s.uses === 'actions/checkout@v4').with['persist-credentials'], false)
    assert(!JSON.stringify(job).includes('secrets.'), 'REMOTE_SECRET_IN_CERTIFICATION')
    assert(!JSON.stringify(job).match(/supabase\s+(?:db\s+push|link|functions\s+deploy)|vercel\s+(?:deploy|--prod)/), 'DEPLOY_COMMAND_IN_CERTIFICATION')
  }
  const sql = certification.jobs.sql.steps
  const linuxSteps = certification.jobs.linux.steps
  const readinessIndex = linuxSteps.findIndex(s => s.name === 'Chrome infrastructure readiness')
  const pdfIndex = linuxSteps.findIndex(s => s.name === 'Real PDF runtime')
  assert(readinessIndex >= 0 && pdfIndex > readinessIndex, 'CHROME_READINESS_ORDER')
  assert(linuxSteps[readinessIndex].run.includes('r1-19-chrome-readiness.mjs --ci-only'), 'CHROME_READINESS_REQUIRED')
  assert(!/testTimeout|retry|continue-on-error|no-sandbox/.test(linuxSteps[pdfIndex].run), 'PDF_GATE_RELAXED')
  assert.equal(linuxSteps[pdfIndex]['continue-on-error'], undefined, 'PDF_GATE_RELAXED')
  assert(sql.some(s => s.run === 'node scripts/qa/reconciliation/r1-18-ci.mjs --local-only'))
  const cleanup = sql.find(s => s.name === 'Cleanup only manifest-owned resources')
  assert.equal(cleanup.if, 'always()')
  assert.equal(cleanup.run, 'node scripts/qa/reconciliation/r1-19-ci-cleanup.mjs --local-only', 'WRONG_CLEANUP_ENTRYPOINT')
  const artifacts = sql.find(s => s.uses === 'actions/upload-artifact@v4')
  assert.equal(artifacts.if, 'always()')
  const paths = artifacts.with.path.trim().split('\n').map(s => s.trim())
  for (const prefix of ['pa', 'cred', 'inl', 'cnab']) {
    for (const suffix of ['resources', 'suite']) assert(paths.includes(`rehearsal/reports/bw_email03_r110${prefix}_*-${suffix}.json`), 'MISSING_OWNERSHIP_EVIDENCE')
  }
  assert(paths.includes('rehearsal/reports/R1_19_CLEANUP_LIFECYCLE.json'))
  assert(paths.includes('rehearsal/reports/R1_19_CI_*_PREFLIGHT.json'))
  assert(paths.includes('rehearsal/reports/R1_18_CI_SQL.json'))
  const standardSteps = standard.jobs.validate.steps
  assert.equal(standardSteps.find(s => s.name === 'Build').if, inverseCondition, 'STANDARD_SECRET_ISOLATION')
  const isolated = standardSteps.find(s => s.name === 'Reconciliation build (isolated placeholders)')
  assert.equal(isolated.if, branchCondition, 'STANDARD_PLACEHOLDER_ALLOWLIST')
  assert.deepEqual(isolated.env, {
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-placeholder-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'ci-placeholder-service-role-key',
    PORTAL_FIDC_CREDENTIALS_JSON: '{}',
  })
  for (const s of standardSteps.filter(s => s.name !== 'Build')) assert(!JSON.stringify(s).includes('secrets.'), 'REAL_SECRET_AVAILABLE_TO_RECONCILIATION')
  return { result: 'PASS', branch, certificationBranches, releaseBranch, vercelBranchBlocked: true, vercelReleaseBlocked: true, remoteSecretsExcluded: true, supabaseGitIntegration: 'REQUIRES_EXTERNAL_EVIDENCE' }
}
