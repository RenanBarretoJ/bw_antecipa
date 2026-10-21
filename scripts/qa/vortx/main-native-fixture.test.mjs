import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertCanonicalProfile } from './main-native-fixture.mjs'

const user = '21000000-0000-4000-8000-000000000003', email = 'native-fixture@example.invalid'
const canonical = { id: user, email, role: 'cedente', status: 'ativo', nome_completo: email }
test('accepts the single canonical Auth-generated profile', () => {
  assert.doesNotThrow(() => assertCanonicalProfile({ rowCount: 1, rows: [canonical] }, user, email))
})
test('missing or duplicated automatic profiles fail before fixture mutation', () => {
  for (const rowCount of [0, 2]) assert.throws(() => assertCanonicalProfile({ rowCount, rows: [] }, user, email), /EXACTLY_ONE_CANONICAL_PROFILE_REQUIRED/)
})
test('unexpected identity, role, status or canonical name fails closed', () => {
  for (const [key, value] of [['id', 'other'], ['email', 'other@example.invalid'], ['role', 'gestor'], ['status', 'inativo'], ['nome_completo', 'Unexpected']]) {
    assert.throws(() => assertCanonicalProfile({ rowCount: 1, rows: [{ ...canonical, [key]: value }] }, user, email), /UNEXPECTED_CANONICAL_PROFILE_ATTRIBUTE/)
  }
})
