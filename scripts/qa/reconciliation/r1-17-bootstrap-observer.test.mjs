import assert from 'node:assert/strict'
import test from 'node:test'
import { scrub } from './r1-17-bootstrap-observer.mjs'

test('diagnostic redaction preserves startup evidence but removes credentials and protocol', () => {
  const input = ['Starting database...', 'password=fixture-secret', 'Authorization: Bearer fixture-token', 'PG Send: password-message', 'Access key: fixture-access', 'Secret key: fixture-secret', 'Server listening at http://127.0.0.1:5000', 'container is not ready: unhealthy'].join('\n')
  const output = scrub(input)
  assert(!/fixture-|password-message/.test(output))
  assert.match(output, /Starting database/)
  assert.match(output, /Server listening/)
  assert.match(output, /unhealthy/)
})

test('diagnostic redaction removes JWTs and database URLs', () => {
  const jwt = 'eyJ' + 'a'.repeat(50)
  const output = scrub(jwt + '\npostgresql://qa:qa@127.0.0.1:58302/postgres')
  assert(!output.includes(jwt))
  assert(!output.includes('qa:qa'))
  assert.match(output, /JWT_REDACTED/)
  assert.match(output, /LOCAL_DATABASE_URL_REDACTED/)
})
