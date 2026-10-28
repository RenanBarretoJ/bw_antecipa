import { expect, it } from 'vitest'
import { verifyLocalContract } from './email03-local-contracts.mjs'

it('Gestor imports synthetic XML using native password, TOTP, RLS, repository and private Storage', async () => {
  const result = await verifyLocalContract('GESTOR_XML')
  expect(result.status).toBe('PASS')
  expect(result.nativeAuth).toBe(true)
  expect(result.checks).toContain('NATIVE_PASSWORD_TOTP_CANONICAL_SESSION')
  expect(result.checks).toContain('DUPLICATE_ONE_NOTE_ONE_OBJECT')
}, 120000)
