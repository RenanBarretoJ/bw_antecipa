import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { parseRuntimeErrors, projectVercelReleaseMetadata, assessMinuteCronSupport } from '../../../scripts/qa/serpro/release-observability.mjs'

describe('release observation is explicit, sanitized and never assumes a clean runtime', () => {
  it('stops on cycles/excessive nesting without evaluating or echoing input', () => {
    const input: { result?: unknown } = {}
    input.result = input
    expect(parseRuntimeErrors(input)).toMatchObject({ status: 'INCONCLUSIVE', reason: 'EXCESSIVE_NESTING' })
  })
  it.each([
    ['--errors-stdin', '## Runtime Errors\n\nNo runtime errors found.', 0],
    ['--errors-stdin', '{invalid', 2],
    ['--errors-stdin', JSON.stringify({ errors: [{ count: 1, message: 'private-no-echo' }], total: 1 }), 1],
    ['--metadata-stdin', JSON.stringify({ id: 'dpl_Approved123', protectionBypass: { 'private-no-echo': {} } }), 0],
    ['--invalid-mode', 'private-no-echo', 2],
  ])('runs the offline collector without raw persistence: %s exit %s', (mode, input, status) => {
    const result = spawnSync(process.execPath, ['scripts/qa/serpro/observe-release.mjs', String(mode)], { input: String(input), encoding: 'utf8', timeout: 5000, windowsHide: true })
    expect(result.status).toBe(status)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('private-no-echo')
    expect(() => JSON.parse(result.stdout)).not.toThrow()
  })
  it.each([
    { errors: [], total: 0 },
    { result: { groups: [], total: 0 } },
    JSON.stringify({ errors: [], total: 0 }),
    { content: [{ type: 'text', text: '## Runtime Errors\n\nNo runtime errors found.' }] },
    '# Runtime Errors\n\nNo runtime errors detected in the selected time window.',
  ])('recognizes a supported empty response without certifying its scope: %j', input => {
    expect(parseRuntimeErrors(input)).toMatchObject({ status: 'NO_ERRORS_REPORTED', clusters: 0, scopeVerified: false })
  })
  it.each([
    undefined, '', [], 'No errors', '## Runtime Errors\n\n> No runtime errors found.',
    '## Runtime Errors\n\nNo runtime errors found.\nRequest failed.',
    { errors: [] }, { errors: [], total: 0, hasMore: true },
    { errors: [], total: 1 }, { errors: [], total: 0, pagination: { next: 'next-page' } },
    { isError: true, content: [{ type: 'text', text: '## Runtime Errors\n\nNo runtime errors found.' }] },
    { error: 'denied', result: { errors: [], total: 0 } },
    { errors: [], total: 0, truncated: true }, '{invalid',
  ])('does not turn an unknown or incomplete response into PASS: %j', input => {
    expect(parseRuntimeErrors(input)).toMatchObject({ status: 'INCONCLUSIVE', clusters: null })
  })
  it('does not return messages, URLs, tokens, or raw rows', () => {
    const result = parseRuntimeErrors({ errors: [{ count: 2, message: 'private-secret', url: 'https://private.invalid/?secret=sensitive' }], total: 1 })
    expect(result).toMatchObject({ status: 'ERRORS_PRESENT', clusters: 1 })
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it('recognizes a supported Markdown table while excluding its error text', () => {
    const result = parseRuntimeErrors('## Runtime Errors\n\n| Error | Count |\n| --- | --- |\n| private-message | 2 |')
    expect(result).toMatchObject({ status: 'ERRORS_PRESENT', clusters: 1 })
    expect(JSON.stringify(result)).not.toContain('private-message')
  })
  it('excludes even token-as-key bypass data without reading the nested property', () => {
    const deployment = { id: 'dpl_Approved123', projectId: 'prj_Target123', url: 'approved.vercel.app', target: 'production', readyState: 'READY', nodeVersion: '22.x',
      meta: { bwApprovedCommit: 'a'.repeat(40), bwApprovedTree: 'b'.repeat(40), token: 'private-meta' },
      aliases: [{ alias: 'portal.example.com', deploymentId: 'dpl_Approved123', get protectionBypass() { throw Error('must not read') } }],
      get env() { throw Error('must not read') }, get protectionBypass() { throw Error('must not read') } }
    const result = projectVercelReleaseMetadata({ deployment })
    expect(result).toMatchObject({ id: 'dpl_Approved123', nodeVersion: '22.x', sourceLabelsAreIndependentGitProof: false })
    expect(JSON.stringify(result)).not.toMatch(/protectionBypass|private-meta|env/)
  })
  it('does not accept a URL with a query or credentials as an alias/host', () => {
    const result = projectVercelReleaseMetadata({ url: 'https://private@portal.example.com?secret=abc', aliases: ['portal.example.com?token=abc'] })
    expect(result).toMatchObject({ url: null, aliases: [] })
  })
  it('supports the raw Vercel alias field without inspecting bypasses', () => {
    expect(projectVercelReleaseMetadata({ id: 'dpl_Approved123', alias: ['portal.example.com'] })).toMatchObject({
      aliases: [{ alias: 'portal.example.com', deploymentId: null }],
    })
  })
  it.each(['pro', 'enterprise'])('permits a minute cron only on a verified eligible plan: %s', plan => {
    expect(assessMinuteCronSupport(plan)).toEqual({ status: 'SUPPORTED', schedule: '* * * * *', upgradesAuthorized: false })
  })
  it.each(['hobby', undefined, 'unknown'])('stops rather than upgrading or assuming a plan: %s', plan => {
    expect(assessMinuteCronSupport(plan)).toMatchObject({ status: 'BLOCKED', upgradesAuthorized: false })
  })
})
