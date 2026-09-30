import assert from 'node:assert/strict'
import { readFileSync, appendFileSync } from 'node:fs'

// Test-process HTTP fixture only. Never imported by application code or deployed.
assert.equal(process.env.EMAIL_INTAKE_DISPOSABLE_SMOKE, 'true')
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57841')
const fixture = JSON.parse(readFileSync(process.env.EMAIL_INTAKE_GRAPH_FIXTURE, 'utf8'))
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.hostname === 'login.microsoftonline.com') {
    assert.equal(url.pathname, '/11111111-1111-4111-8111-111111111111/oauth2/v2.0/token')
    assert.equal(init?.method, 'POST')
    return Response.json({ access_token: 'DISPOSABLE_QA_HTTP_FIXTURE', expires_in: 3600 })
  }
  if (url.hostname === 'graph.microsoft.com') {
    assert.equal(url.href, fixture.url)
    assert.equal(init?.method ?? 'GET', 'GET')
    appendFileSync(fixture.counter, 'DOWNLOAD\n')
    return new Response(Buffer.from(fixture.bytes, 'base64'), { headers: { 'content-type': 'application/pdf' } })
  }
  return originalFetch(input, init)
}
