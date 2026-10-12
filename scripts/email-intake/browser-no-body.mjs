/** RFC 9110 sections 6.4.1, 9.3.2, 15.3.6. Informational responses are not final. */
export function bodylessResponse(method, status) {
  return Number.isInteger(status) && status >= 100 && status <= 599
    && (method === 'HEAD' || status < 200 || [204, 205, 304].includes(status))
}

/** Header values exist only on this stack. Never return names or matching snippets. */
export function inspectResponseHeaders(headers, detect) {
  const result = { headersInspected: false, sensitiveHeaderMatch: false, matchedSecretClasses: [],
    headerInspectionErrorClass: null, sessionCookieHeaders: 0 }
  try {
    if (!headers || typeof headers !== 'object') throw Error('HEADERS_UNAVAILABLE')
    const entries = (Array.isArray(headers) ? headers.map(h => [h.name, h.value]) : Object.entries(headers))
      .flatMap(([name, value]) => typeof name === 'string' && name.toLowerCase() === 'set-cookie' && typeof value === 'string'
        ? value.split('\n').map(part => [name, part]) : [[name, value]])
    const found = new Set()
    for (const [rawName, value] of entries) {
      if (typeof rawName !== 'string' || typeof value !== 'string') throw Error('INVALID_HEADER_METADATA')
      const name = rawName.toLowerCase()
      const sensitiveNames = [['CLIENT_SECRET', /(?:^|[-_])client[-_]?secret$/], ['ACCESS_TOKEN', /(?:^|[-_])access[-_]?token$/],
        ['REFRESH_TOKEN', /(?:^|[-_])refresh[-_]?token$/], ['SERVICE_ROLE_KEY', /(?:^|[-_])service[-_]role(?:[-_]key)?$/],
        ['CREDENTIAL_SECRET', /(?:^|[-_])credential[-_]secret$/]]
      for (const [kind, pattern] of sensitiveNames) if (value && pattern.test(name)) found.add(kind)
      const sessionCookie = name === 'set-cookie' && /^sb-[a-z0-9]+-auth-token(?:\.\d+)?=/.test(value)
      if (sessionCookie) result.sessionCookieHeaders++
      // Only access/refresh fields of recognized Supabase session cookies are exempt.
      // Integration/known secrets, service-role JWTs and private keys remain forbidden.
      const texts = [value, JSON.stringify({ [name.replaceAll('-', '_')]: value })]
      if (['location', 'content-location', 'link'].includes(name)) {
        if (/[?&](?:token|access_token|refresh_token|client_secret|sig|signature|x-amz-signature|x-goog-signature)=/i.test(value)) found.add('SENSITIVE_URL_PARAMETER')
      }
      if (name === 'set-cookie') {
        const pair = value.split(';', 1)[0], split = pair.indexOf('=')
        if (split >= 0) {
          const cookieValue = pair.slice(split + 1)
          texts.push(JSON.stringify({ [pair.slice(0, split)]: cookieValue }))
          try { texts.push(decodeURIComponent(cookieValue)) } catch { /* Raw value is still inspected. */ }
          if (cookieValue.startsWith('base64-')) texts.push(Buffer.from(cookieValue.slice(7), 'base64url').toString('utf8'))
        }
      }
      for (const text of texts) for (const kind of detect(text)) {
        if (!(sessionCookie && ['ACCESS_TOKEN', 'REFRESH_TOKEN'].includes(kind))) found.add(kind)
      }
    }
    result.matchedSecretClasses = [...found].sort()
    result.sensitiveHeaderMatch = found.size > 0
    result.headersInspected = true
  } catch {
    result.headerInspectionErrorClass = 'HEADER_INSPECTION_FAILED'
  }
  return result
}

export function noBodyRequest(method) {
  return { method, responseReceived: false, headersInspected: false, bodyExpected: null,
    classification: null, terminalState: 'REQUEST', inspectionTime: null, terminalTime: null,
    sensitiveHeaderMatch: false, matchedSecretClasses: [], headerInspectionErrorClass: null }
}

/** Called synchronously at Network.responseReceived, before later cancellation events. */
export function receiveNoBodyResponse(evidence, { status, headers }, detect, now = performance.now()) {
  if (evidence.cancellationTime !== undefined) return evidence
  evidence.responseReceived = true
  evidence.status = status
  evidence.bodyExpected = !bodylessResponse(evidence.method, status)
  evidence.classification = evidence.bodyExpected ? 'BODY_EXPECTED' : 'NO_BODY_EXPECTED'
  if (evidence.bodyExpected) return evidence
  Object.assign(evidence, inspectResponseHeaders(headers, detect))
  evidence.inspectionTime = now
  evidence.terminalState = evidence.headersInspected ? 'HEADERS_INSPECTED' : 'HEADERS_FAILED'
  if (status >= 200 && evidence.headersInspected && !evidence.sensitiveHeaderMatch && !evidence.headerInspectionErrorClass) {
    evidence.terminalState = 'NO_BODY_TERMINAL'
    evidence.terminalTime = now
  }
  return evidence
}

export function cancelNoBodyResponse(evidence, now = performance.now()) {
  evidence.cancellationTime = now
  return evidence.responseReceived && evidence.headersInspected && evidence.bodyExpected === false
    && evidence.terminalState === 'NO_BODY_TERMINAL' && evidence.terminalTime <= now
    && !evidence.sensitiveHeaderMatch && !evidence.headerInspectionErrorClass
    ? 'CANCELLED_AFTER_TERMINAL_NO_BODY' : 'UNINSPECTED_ABORT'
}
