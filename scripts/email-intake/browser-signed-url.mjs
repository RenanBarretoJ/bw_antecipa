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
    bucket: null, expiryPresent: false, ttlSeconds: null, queryParamNames: [], authorization: 'FAIL', sourceField,
    valueType: 'URL', lengthClass: typeof raw !== 'string' ? 'INVALID' : raw.length <= 512 ? 'LE_512' : raw.length <= 2048 ? 'LE_2048' : 'GT_2048' }
  let stage = 'CONTEXT'
  const requireToken = (valid, rule) => { if (!valid) { evidence.detectorRule = rule; throw Error() } }
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
    requireToken(parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part)), 'signed_url_jwt_segments')
    let header, claims
    try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url')) }
    catch { requireToken(false, 'signed_url_jwt_json') }
    evidence.tokenShape = {
      algorithm: ['HS256', 'HS384', 'HS512'].includes(header?.alg) ? header.alg : 'OTHER',
      keyIdPresent: typeof header?.kid === 'string',
      headerKeysAllowed: exactKeys(header, ['alg', 'kid']),
      claimKeysAllowed: exactKeys(claims, ['url', 'scope', 'iat', 'exp']),
      scope: claims?.scope === 'download' ? 'DOWNLOAD' : claims?.scope === undefined ? 'ABSENT' : 'OTHER',
      objectMatches: claims?.url === object,
    }
    evidence.expiryPresent = Number.isInteger(claims?.exp)
    if (Number.isInteger(claims?.iat) && evidence.expiryPresent) evidence.ttlSeconds = claims.exp - claims.iat
    requireToken(exactKeys(header, ['alg', 'kid']), 'signed_url_header_keys')
    // Both formats were observed on the issuing Storage. Algorithm alone never
    // authorizes a URL: the exact object, expiry, actor and signature are checked below.
    requireToken(['HS256', 'HS512'].includes(header.alg), 'signed_url_header_algorithm')
    requireToken(/^[A-Za-z0-9_-]{1,128}$/.test(header.kid ?? ''), 'signed_url_header_key_id')
    requireToken(exactKeys(claims, ['url', 'scope', 'iat', 'exp']), 'signed_url_claim_keys')
    requireToken(claims.scope === 'download', 'signed_url_download_scope')
    requireToken(claims.url === object, 'signed_url_object_binding')
    requireToken(!detect(JSON.stringify(header)).length, 'signed_url_header_secret')
    requireToken(!detect(JSON.stringify(claims)).length, 'signed_url_claim_secret')
    requireToken(!detect(raw).some(kind => !['SIGNED_URL', 'QUERY_TOKEN', 'JWT'].includes(kind)), 'signed_url_embedded_secret')
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
  // Rescan the complete response after replacing only fully authorized URLs.
  // A JWT or token parameter anywhere else remains a failure.
  const matches = new Set(remaining)
  if (remaining.includes('SIGNED_URL')) matches.add('UNEXPECTED_SIGNED_URL')
  return { matchedSecretClasses: [...matches].sort(), signedUrls: evidence }
}
