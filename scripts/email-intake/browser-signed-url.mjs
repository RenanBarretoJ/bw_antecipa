const sourceField = 'action.result.url'
const buckets = new Set(['notas-fiscais', 'documentos-v2'])
const prefix = '/storage/v1/object/sign/'
const exactKeys = (object, allowed) => object && typeof object === 'object' && !Array.isArray(object)
  && Object.keys(object).every(key => allowed.includes(key))

/** Signature verification is delegated to the issuing Storage, without credentials or redirects. */
export async function verifyStorageSignature(url) {
  const response = await fetch(url, { method: 'GET', redirect: 'manual', headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(10000) })
  try { return [200, 206].includes(response.status) } finally { await response.body?.cancel() }
}

/** All values, including JWT claims and object paths, stay in memory. */
export async function validateSignedStorageUrl(raw, surface, policy, detect, now = Date.now()) {
  const evidence = { classification: 'UNEXPECTED_SIGNED_URL', scheme: null, host: null,
    pathTemplate: '/storage/v1/object/sign/<bucket>/<authorized-object>', provider: 'SUPABASE_STORAGE',
    bucket: null, expiryPresent: false, ttlSeconds: null, queryParamNames: [], authorization: 'FAIL', sourceField }
  let stage = 'CONTEXT'
  try {
    if (!policy || surface.method !== 'POST' || surface.status !== 200 || surface.contentType !== 'text/x-component'
      || new URL(surface.url).origin !== policy.appOrigin) throw Error()
    const url = new URL(raw), expected = new URL(policy.storageOrigin)
    stage = 'ORIGIN'
    evidence.scheme = url.protocol === 'https:' ? 'https' : 'UNEXPECTED_SCHEME'
    evidence.host = url.origin === expected.origin ? expected.hostname : 'UNEXPECTED_HOST'
    if (expected.protocol !== 'https:' || url.protocol !== 'https:' || url.origin !== expected.origin || url.username || url.password || url.hash) throw Error()
    stage = 'OBJECT'
    if (!url.pathname.startsWith(prefix) || /%2f|%5c|\\|(?:^|\/)\.{1,2}(?:\/|$)/i.test(raw.split('?')[0])) throw Error()
    const object = decodeURIComponent(url.pathname.slice(prefix.length)), split = object.indexOf('/')
    const bucket = object.slice(0, split), path = object.slice(split + 1)
    if (split < 1 || !path || !buckets.has(bucket) || !policy.allowedBuckets.includes(bucket)) throw Error()
    evidence.bucket = bucket
    const names = [...url.searchParams.keys()]
    evidence.queryParamNames = names.every(name => name === 'token') ? names : ['UNEXPECTED_QUERY']
    if (names.length !== 1 || names[0] !== 'token') throw Error()
    stage = 'TOKEN'
    const token = url.searchParams.get('token'), parts = token.split('.')
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw Error()
    const header = JSON.parse(Buffer.from(parts[0], 'base64url')), claims = JSON.parse(Buffer.from(parts[1], 'base64url'))
    if (!exactKeys(header, ['alg', 'kid']) || header.alg !== 'HS512' || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid ?? '')
      || !exactKeys(claims, ['url', 'scope', 'iat', 'exp']) || claims.scope !== 'download' || claims.url !== object
      || detect(JSON.stringify(header)).length || detect(JSON.stringify(claims)).length || detect(raw).some(kind => kind !== 'SIGNED_URL')) throw Error()
    stage = 'EXPIRY'
    evidence.expiryPresent = Number.isInteger(claims.exp)
    if (!Number.isInteger(claims.iat) || !evidence.expiryPresent) throw Error()
    const seconds = Math.floor(now / 1000), ttl = claims.exp - claims.iat
    evidence.ttlSeconds = ttl
    if (!(ttl > 0 && ttl <= policy.maxTtlSeconds && policy.maxTtlSeconds <= 600)
      || claims.exp <= seconds || claims.iat > seconds + 30) throw Error()
    stage = 'AUTHORIZATION'
    const proof = await policy.authorize({ bucket, path, requestPath: new URL(surface.url).pathname, actionId: surface.actionId, sourceField })
    if (!proof?.actorAuthenticated || !proof.authorized || !proof.scopeMatches || !proof.crossFundDenied) throw Error()
    evidence.authorization = 'PASS'
    stage = 'SIGNATURE'
    if (!await (policy.verifySignature ?? verifyStorageSignature)(url.href)) throw Error()
    evidence.classification = 'EXPECTED_EPHEMERAL_SIGNED_URL'
  } catch { evidence.failureClass = stage }
  return evidence
}

/** Only a direct, successful Server Action result.url frame is eligible. Other occurrences fail closed. */
export async function inspectSignedResponse(body, surface, policy, detect) {
  const initial = detect(body), evidence = []
  if (!initial.includes('SIGNED_URL')) return { matchedSecretClasses: initial, signedUrls: evidence }
  const lines = body.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const frame = /^([a-f0-9]+:)(\{.*\})$/.exec(lines[index]); if (!frame) continue
    let result; try { result = JSON.parse(frame[2]) } catch { continue }
    if (JSON.stringify(result) !== frame[2] || !exactKeys(result, ['success', 'url']) || result.success !== true || typeof result.url !== 'string'
      || !detect(result.url).includes('SIGNED_URL')) continue
    const inspected = await validateSignedStorageUrl(result.url, surface, policy, detect)
    evidence.push(inspected)
    if (inspected.classification === 'EXPECTED_EPHEMERAL_SIGNED_URL') {
      lines[index] = frame[1] + JSON.stringify({ ...result, url: '[EXPECTED_EPHEMERAL_SIGNED_URL]' })
    }
  }
  const remaining = detect(lines.join('\n'))
  const matches = new Set([...initial.filter(kind => kind !== 'SIGNED_URL'), ...remaining])
  if (remaining.includes('SIGNED_URL')) matches.add('UNEXPECTED_SIGNED_URL')
  return { matchedSecretClasses: [...matches].sort(), signedUrls: evidence }
}
