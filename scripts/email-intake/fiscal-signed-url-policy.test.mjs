import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fiscalSignedUrlPolicy } from './fiscal-signed-url-policy.mjs'
import { secretClasses } from './browser-redaction.mjs'

const id = '11111111-1111-4111-8111-111111111111'
const object = { bucket: 'notas-fiscais', path: 'reservation/generation/document.pdf' }
const input = { ...object, requestPath: `/cedente/notas-fiscais/${id}`, actionId: 'a'.repeat(42) }
function fixture({ foreignVisible = false, membership = 'fund-b', storageAllowed = false, actorVisible = true } = {}) {
  const client = (user, visible) => ({
    auth: { getUser: async () => ({ data: { user: { id: user } } }), getSession: async () => ({ data: { session: { access_token: 'synthetic' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: visible ? { id, fundo_id: 'fund-a', cedente_id: 'cedente-a' } : null }) }) }) }),
    storage: { from: () => ({ createSignedUrl: async () => storageAllowed ? { data: { signedUrl: 'synthetic' } } : { error: { name: 'Denied' } } }) },
  })
  return fiscalSignedUrlPolicy({
    db: { query: async sql => ({ rows: sql.includes('usuario_fundos') ? [{ fundo_id: membership }] : [{ ...object, fundo_id: 'fund-a', cedente_id: 'cedente-a' }] }) },
    actor: client('actor-a', actorVisible), foreignActor: client('actor-b', foreignVisible), fund: 'fund-a', foreignFund: 'fund-b',
    appOrigin: 'https://preview.invalid', storageOrigin: 'https://preview-ref.supabase.co', ref: 'preview-ref', detect: secretClasses,
  })
}

test('authorization requires actor visibility, exact canonical object, isolated membership and denied Storage issuance', async () => {
  for (const options of [{ foreignVisible: true }, { membership: 'fund-a' }, { storageAllowed: true }, { actorVisible: false }]) {
    assert.equal((await fixture(options).authorize(input)).crossFundDenied, false)
  }
  assert.equal((await fixture().authorize({ ...input, path: 'other/document.pdf' })).scopeMatches, false)
  assert.equal((await fixture().authorize({ ...input, requestPath: '/unknown' })).authorized, false)
})

test('only an explicit denial from the actual issuer action certifies cross-fund isolation', async t => {
  for (const [body, status, expected] of [
    ['1:{"success":false,"message":"Arquivo indisponivel ou sem permissao de acesso."}\n', 200, true],
    ['1:{"success":true,"url":"https://unexpected.invalid/storage/v1/object/sign/object?token=synthetic"}', 200, false],
    ['1:{"success":false,"message":"Not found"}', 200, false],
    ['1:{"success":false,"message":"Arquivo indisponivel ou sem permissao de acesso."}', 500, false],
    ['1:{"success":false,"message":"Arquivo indisponivel ou sem permissao de acesso."}\n2:{"client_secret":"synthetic"}', 200, false],
  ]) {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url.origin, 'https://preview.invalid')
      assert.equal(url.pathname, input.requestPath)
      assert.equal(options.redirect, 'manual')
      assert.equal(options.body, JSON.stringify([id]))
      return new Response(body, { status, headers: { 'content-type': 'text/x-component' } })
    })
    assert.equal((await fixture().authorize(input)).crossFundDenied, expected)
    t.mock.restoreAll()
  }
})
