/** Offline decoders only: no CLI dispatch, HTTP, credentials, or raw persistence.
 * Return counts/provenance, never error messages, routes, fiscal data or bypasses.
 * Recognizing a format does not certify the requested project/time window. */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = value => Number.isSafeInteger(value) && value >= 0
const inconclusive = reason => ({ status: 'INCONCLUSIVE', clusters: null, reason, scopeVerified: false })

export const parseRuntimeErrors = value => parseErrors(value, 0)
function parseErrors(value, depth) {
  if (depth > 8) return inconclusive('EXCESSIVE_NESTING')
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text || text.length > 1024 * 1024) return inconclusive('EMPTY_OR_OVERSIZED')
    if (text.startsWith('{') || text.startsWith('[')) {
      try { return parseErrors(JSON.parse(text), depth + 1) }
      catch { return inconclusive('INVALID_JSON') }
    }
    // Intentionally narrow allowlist. Additional prose, fences, quotes, errors
    // or truncation cannot hide behind an isolated "no errors" substring.
    if (/^#{1,2} Runtime Errors\r?\n\s*\r?\nNo runtime errors (?:found|detected)(?: in (?:the )?(?:selected|specified|requested) (?:time )?(?:range|window))?\.?$/i.test(text)) {
      return { status: 'NO_ERRORS_REPORTED', clusters: 0, format: 'MARKDOWN_EMPTY', scopeVerified: false }
    }
    const lines = text.split(/\r?\n/).filter(line => line.trim())
    if (/^#{1,2} Runtime Errors$/i.test(lines[0] ?? '') && lines[1] === '| Error | Count |'
      && /^\|\s*-+\s*\|\s*-+\s*\|$/.test(lines[2] ?? '') && lines.length > 3) {
      const rows = lines.slice(3)
      if (rows.every(line => /^\|[^|\r\n]+\|\s*[1-9]\d*\s*\|$/.test(line))) {
        return { status: 'ERRORS_PRESENT', clusters: rows.length, format: 'MARKDOWN_TABLE', scopeVerified: false }
      }
    }
    return inconclusive('UNSUPPORTED_MARKDOWN')
  }
  if (!record(value)) return inconclusive('UNSUPPORTED_SHAPE')
  if ((value.isError != null && value.isError !== false) || value.error
    || (value.truncated != null && value.truncated !== false)) return inconclusive('ERROR_OR_TRUNCATED')
  if (value.structuredContent !== undefined && value.structuredContent !== null) return parseErrors(value.structuredContent, depth + 1)
  if (value.result !== undefined) return parseErrors(value.result, depth + 1)
  if (Array.isArray(value.content)) {
    if (value.content.length !== 1 || value.content[0]?.type !== 'text') return inconclusive('AMBIGUOUS_CONTENT')
    return parseErrors(value.content[0].text, depth + 1)
  }
  const groups = Array.isArray(value.errors) ? value.errors : Array.isArray(value.groups) ? value.groups : null
  if (!groups || !integer(value.total)) return inconclusive('MISSING_EXPLICIT_TOTAL')
  if (value.pagination?.next || (value.hasMore != null && value.hasMore !== false) || value.total !== groups.length) return inconclusive('INCOMPLETE_GROUPS')
  if (!groups.every(group => record(group) && integer(group.count) && group.count > 0)) return inconclusive('INVALID_GROUP')
  return { status: value.total === 0 ? 'NO_ERRORS_REPORTED' : 'ERRORS_PRESENT', clusters: value.total,
    format: 'JSON_GROUPS', scopeVerified: false }
}

const safeString = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null
const id = value => safeString(value, /^(?:dpl|prj|team)_[A-Za-z0-9]+$/)
const host = value => safeString(value, /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i)
const hash = value => safeString(value, /^[0-9a-f]{40}$/)

export function projectVercelReleaseMetadata(input) {
  if (!record(input)) return { status: 'INCONCLUSIVE' }
  const deployment = record(input.deployment) ? input.deployment : input
  const aliases = Array.isArray(deployment.alias) ? deployment.alias : deployment.aliases
  // Do not enumerate, clone, stringify or return the input, meta, env or
  // protectionBypass. Bypass tokens can themselves be object keys.
  return {
    id: id(deployment.id), projectId: id(deployment.projectId),
    url: host(deployment.url),
    target: ['production', 'preview'].includes(deployment.target) ? deployment.target : null,
    state: ['READY', 'ERROR', 'BUILDING', 'QUEUED', 'CANCELED'].includes(deployment.readyState) ? deployment.readyState : null,
    nodeVersion: safeString(deployment.nodeVersion, /^\d+\.x$/),
    approvedCommitLabel: hash(deployment.meta?.bwApprovedCommit),
    approvedTreeLabel: hash(deployment.meta?.bwApprovedTree),
    sourceLabelsAreIndependentGitProof: false,
    aliases: Array.isArray(aliases) ? aliases.map(alias => ({
      alias: host(typeof alias === 'string' ? alias : alias?.alias),
      deploymentId: id(alias?.deploymentId),
    })).filter(alias => alias.alias !== null) : [],
  }
}

export function assessMinuteCronSupport(plan) {
  if (plan === 'pro' || plan === 'enterprise') return { status: 'SUPPORTED', schedule: '* * * * *', upgradesAuthorized: false }
  return { status: 'BLOCKED', reason: plan === 'hobby' ? 'PLAN_REQUIRES_DAILY_CRON' : 'PLAN_UNVERIFIED', upgradesAuthorized: false }
}
