import { createRequire } from 'node:module'

/** Protocol errors may contain URLs or payloads. Only closed classes leave memory. */
export function protocolError(error) {
  const message = String(error?.originalMessage || error?.message || '')
  const rules = [
    ['INVALID_INTERCEPTION_ID', /invalid interceptionid|invalid interception id/i],
    ['RESOURCE_ID_NOT_FOUND', /no resource with given identifier/i],
    ['RESPONSE_STAGE_REQUIRED', /only get response body.*headers received|only.*response.*stage/i],
    ['RESPONSE_BODY_ALREADY_TAKEN', /body.*already.*taken|body.*stream.*already/i],
    ['REQUEST_CANCELLED', /aborted|cancelled|canceled/i],
    ['TARGET_OR_SESSION_CLOSED', /target closed|session closed/i],
    ['COMMAND_NOT_SUPPORTED', /wasn't found|method not found/i],
    ['COMMAND_TIMEOUT', /timed out|timeout/i],
  ]
  return { errorClass: rules.find(([, pattern]) => pattern.test(message))?.[0] ?? 'OTHER_PROTOCOL_ERROR',
    code: Number.isInteger(error?.code) ? error.code : null }
}

/** IDs are opaque local aliases; no request/header/body objects are retained. */
export async function createProtocolTrace(cdp) {
  const timeline = [], started = performance.now(), ids = new Map()
  const id = (kind, raw) => {
    if (!raw) return null
    const key = `${kind}:${raw}`
    if (!ids.has(key)) ids.set(key, `${kind}${ids.size + 1}`)
    return ids.get(key)
  }
  const version = await cdp.send('Browser.getVersion')
  const versions = { browser: version.product ?? 'UNKNOWN', protocol: version.protocolVersion ?? 'UNKNOWN',
    puppeteer: createRequire(import.meta.url)('puppeteer-core/package.json').version }
  const record = (event, networkId, fetchId, metadata = {}) => timeline.push({ ms: Math.round(performance.now() - started),
    event, networkId: id('n', networkId), fetchId: id('f', fetchId), ...metadata })
  async function command(name, parameters, { networkId, lifecycle } = {}, options) {
    record(name, networkId, parameters.requestId, { outcome: 'START', lifecycle })
    try {
      const result = await cdp.send(name, parameters, options)
      record(name, networkId, parameters.requestId, { outcome: 'PASS', lifecycle })
      return result
    } catch (error) {
      record(name, networkId, parameters.requestId, { outcome: 'FAIL', lifecycle, ...protocolError(error) })
      throw error
    }
  }
  return { versions, timeline, record, command }
}
