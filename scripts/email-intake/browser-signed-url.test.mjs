import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inspectSignedResponse, validateSignedStorageUrl } from './browser-signed-url.mjs'
import { secretClasses } from './browser-redaction.mjs'

const origin = 'https://preview-project.supabase.co', object = 'documentos-v2/reservation/generation/original.pdf'
const surface = { method: 'POST', status: 200, contentType: 'text/x-component', url: 'https://preview.invalid/cedente/notas-fiscais/note' }
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const now = () => Math.floor(Date.now() / 1000)
function signed({ host = origin, claims = {}, header = {}, query = '' } = {}) {
  return `${host}/storage/v1/object/sign/${object}?token=${encode({ alg: 'HS512', kid: 'synthetic-key-id', ...header })}.${encode({ url: object, scope: 'download', iat: now(), exp: now() + 600, ...claims })}.syntheticSignature${query}`
}
const policy = () => ({ appOrigin: 'https://preview.invalid', storageOrigin: origin, allowedBuckets: ['documentos-v2'], maxTtlSeconds: 600,
  authorize: async ({ bucket, path, requestPath }) => ({ actorAuthenticated: true, authorized: bucket + '/' + path === object,
    scopeMatches: requestPath === '/cedente/notas-fiscais/note', crossFundDenied: true }), verifySignature: async () => true })
const frame = url => '0:{"a":"$@1"}\n1:' + JSON.stringify({ success: true, url }) + '\n'

test('authorized temporary URL passes and evidence contains no token, object or full URL', async () => {
  const url = signed(), result = await inspectSignedResponse(frame(url), surface, policy(), secretClasses)
  assert.deepEqual(result.matchedSecretClasses, [])
  assert.equal(result.signedUrls[0].classification, 'EXPECTED_EPHEMERAL_SIGNED_URL')
  assert.equal(result.signedUrls[0].ttlSeconds, 600)
  for (const value of [url, object, 'syntheticSignature', 'token=']) assert.ok(!JSON.stringify(result).includes(value))
})

test('response without signed URL needs no policy and retains secret detection', async () => {
  assert.deepEqual((await inspectSignedResponse('1:{"success":true}', surface, undefined, secretClasses)).matchedSecretClasses, [])
  assert.deepEqual((await inspectSignedResponse('{"client_secret":"synthetic"}', surface, policy(), secretClasses)).matchedSecretClasses, ['CLIENT_SECRET'])
})

test('homolog HS256 download token requires every authorization and signature gate', async () => {
  const url = signed({ header: { alg: 'HS256' } })
  const result = await inspectSignedResponse(frame(url), surface, policy(), secretClasses)
  assert.deepEqual(result.matchedSecretClasses, [])
  assert.equal(result.signedUrls[0].tokenShape.algorithm, 'HS256')
  assert.equal(result.signedUrls[0].authorization, 'PASS')
  assert.equal(result.signedUrls[0].expiryPresent, true)
  for (const override of [{ verifySignature: async () => false }, { authorize: async () => ({ authorized: false }) }]) {
    assert.ok((await inspectSignedResponse(frame(url), surface, { ...policy(), ...override }, secretClasses)).matchedSecretClasses.length)
  }
})

test('token diagnostics identify the precise predicate without persisting values', async () => {
  for (const [header, claims, rule] of [
    [{ alg: 'HS384' }, {}, 'signed_url_header_algorithm'],
    [{ kid: undefined }, {}, 'signed_url_header_key_id'],
    [{ typ: 'DO_NOT_RECORD' }, {}, 'signed_url_header_keys'],
    [{}, { role: 'service_role' }, 'signed_url_claim_keys'],
    [{}, { scope: 'upload' }, 'signed_url_download_scope'],
    [{}, { url: 'DO_NOT_RECORD' }, 'signed_url_object_binding'],
  ]) {
    const result = await validateSignedStorageUrl(signed({ header, claims }), surface, policy(), secretClasses)
    assert.equal(result.failureClass, 'TOKEN')
    assert.equal(result.detectorRule, rule)
    assert.ok(!JSON.stringify(result).includes('DO_NOT_RECORD'))
  }
})

test('ordinary URLs pass; unknown query tokens and standalone JWTs always fail', async () => {
  assert.deepEqual((await inspectSignedResponse(frame('https://example.invalid/help'), surface, policy(), secretClasses)).matchedSecretClasses, [])
  const session = encode({ alg: 'HS256' }) + '.' + encode({ sub: 'synthetic', role: 'authenticated' }) + '.syntheticSignature'
  const service = encode({ alg: 'HS256' }) + '.' + encode({ role: 'service_role' }) + '.syntheticSignature'
  for (const body of ['https://external.invalid/file?token=opaque', 'token=unknownOpaqueValue', session, service,
    '{"access_token":"graph-token"}', 'Bearer graphTokenSynthetic', '{"refresh_token":"refresh"}']) {
    for (const prefix of ['', frame(signed({ header: { alg: 'HS256' } }))]) {
      assert.ok((await inspectSignedResponse(prefix + body, surface, policy(), secretClasses)).matchedSecretClasses.length)
    }
  }
})

for (const [name, url, overrides] of [
  ['foreign host', () => signed({ host: 'https://foreign.invalid' })],
  ['HTTP', () => signed({ host: origin.replace('https:', 'http:') })],
  ['forbidden bucket', () => signed().replace('/documentos-v2/', '/forbidden/')],
  ['other object', () => signed().replace('/original.pdf', '/other.pdf')],
  ['another fund', signed, { authorize: async () => ({ actorAuthenticated: true, authorized: false, scopeMatches: false, crossFundDenied: true }) }],
  ['missing expiry', () => signed({ claims: { exp: undefined } })],
  ['missing issued time', () => signed({ claims: { iat: undefined } })],
  ['TTL exceeded', () => signed({ claims: { exp: now() + 601 } })],
  ['expired', () => signed({ claims: { iat: now() - 900, exp: now() - 300 } })],
  ['service role', () => signed({ claims: { role: 'service_role' } })],
  ['unsigned token', () => signed({ header: { alg: 'none' } })],
  ['upload token', () => signed({ claims: { scope: 'upload' } })],
  ['scope absent', () => signed({ claims: { scope: undefined } })],
  ['forged signature', signed, { verifySignature: async () => false }],
  ['unauthenticated', signed, { authorize: async () => ({ actorAuthenticated: false, authorized: true, scopeMatches: true, crossFundDenied: true }) }],
  ['unproven cross fund', signed, { authorize: async () => ({ actorAuthenticated: true, authorized: true, scopeMatches: true, crossFundDenied: false }) }],
  ['extra query', () => signed({ query: '&client_secret=DO_NOT_RECORD' })],
  ['duplicate token', () => signed({ query: '&token=DO_NOT_RECORD' })],
]) {
  test(`rejects ${name}`, async () => {
    const result = await validateSignedStorageUrl(url(), surface, { ...policy(), ...overrides }, secretClasses)
    assert.equal(result.classification, 'UNEXPECTED_SIGNED_URL')
    assert.ok(!JSON.stringify(result).includes('DO_NOT_RECORD'))
  })
}

test('unknown surface, nested URL, duplicate keys and additional occurrences cannot gain an exemption', async () => {
  const url = signed()
  for (const body of [JSON.stringify({ url }), '1:' + JSON.stringify({ nested: { success: true, url } }),
    '1:{"success":true,"url":"https://evil.invalid/storage/v1/object/sign/bad","url":' + JSON.stringify(url) + '}',
    frame(url) + '2:' + JSON.stringify({ url: signed({ host: 'https://evil.invalid' }) })]) {
    assert.ok((await inspectSignedResponse(body, surface, policy(), secretClasses)).matchedSecretClasses.includes('UNEXPECTED_SIGNED_URL'))
  }
  assert.ok((await inspectSignedResponse(frame(url), { ...surface, method: 'GET' }, policy(), secretClasses)).matchedSecretClasses.length)
  assert.ok((await inspectSignedResponse(frame(url), surface, undefined, secretClasses)).matchedSecretClasses.length)
})

test('a valid URL never masks integration credentials or unknown signed URL providers', async () => {
  for (const secret of ['{"access_token":"synthetic"}', '{"refresh_token":"synthetic"}', '{"client_secret":"synthetic"}',
    'Bearer syntheticcredential', '-----BEGIN PRIVATE KEY-----', 'vault://credentials/synthetic', '{"job_secret":"synthetic"}',
    'https://s3.invalid/object?X-Amz-Signature=synthetic']) {
    assert.ok((await inspectSignedResponse(frame(signed()) + '\n' + secret, surface, policy(), secretClasses)).matchedSecretClasses.length)
  }
})

test('authorization and signature verifier exceptions persist no diagnostic values', async () => {
  for (const key of ['authorize', 'verifySignature']) {
    const result = await inspectSignedResponse(frame(signed()), surface, { ...policy(), [key]: async () => { throw Error('DO_NOT_RECORD') } }, secretClasses)
    assert.ok(result.matchedSecretClasses.includes('UNEXPECTED_SIGNED_URL'))
    assert.ok(!JSON.stringify(result).includes('DO_NOT_RECORD'))
  }
})
