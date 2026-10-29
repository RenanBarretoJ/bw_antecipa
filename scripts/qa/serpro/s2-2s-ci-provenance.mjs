import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ciBranch = 'feature/s1-serpro-nfe-gestor-20261026'
export const approvedBase = 'b1221a044caaf0211cdfa03ab92e78db2bd34f70'
export function verifyProvenance(event, environment, git) {
  assert.match(environment.nodeVersion, /^v22\./, 'NODE22_REQUIRED')
  assert.equal(environment.eventName, 'pull_request', 'PULL_REQUEST_ONLY')
  const pr = event.pull_request
  assert.equal(pr.head.ref, ciBranch, 'EXACT_BRANCH_REQUIRED')
  assert.equal(pr.base.ref, 'main', 'MAIN_BASE_REQUIRED')
  assert.equal(pr.base.sha, approvedBase, 'BASE_DRIFT_STOP')
  assert.equal(pr.head.repo.full_name, 'RenanBarretoJ/bw_antecipa', 'FORK_REFUSED')
  assert.equal(pr.base.repo.full_name, pr.head.repo.full_name, 'REPOSITORY_DRIFT')
  assert.equal(git('status', '--porcelain'), '', 'CLEAN_CHECKOUT_REQUIRED')
  const executedSha = git('rev-parse', 'HEAD')
  const executedTree = git('rev-parse', 'HEAD^{tree}')
  assert.equal(executedSha, environment.sha, 'EVENT_SHA_DRIFT')
  assert.equal(executedTree, git('rev-parse', `${pr.head.sha}^{tree}`), 'MERGE_TREE_MUST_EQUAL_HEAD_TREE')
  assert.equal(git('show', `${pr.head.sha}:vercel.json`).length > 0, true)
  const config = JSON.parse(git('show', `${pr.head.sha}:vercel.json`))
  assert.equal(config.git?.deploymentEnabled?.[ciBranch], false, 'GIT_DEPLOYMENT_FENCE_REQUIRED')
  return { status: 'EXECUTION_TREE_VERIFIED', event: environment.eventName, executedSha, executedTree,
    headSha: pr.head.sha, baseSha: pr.base.sha, node: environment.nodeVersion,
    proof: executedSha === pr.head.sha ? 'HEAD_SHA_AND_TREE' : 'MERGE_REF_WITH_IDENTICAL_HEAD_TREE',
    remoteDeploymentAllowed: false, newGoRequiredForChangedCandidate: true }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.deepEqual(process.argv.slice(2), ['--ci-only'])
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim()
  console.log(JSON.stringify(verifyProvenance(event, { eventName: process.env.GITHUB_EVENT_NAME,
    sha: process.env.GITHUB_SHA, nodeVersion: process.version }, git), null, 2))
}
