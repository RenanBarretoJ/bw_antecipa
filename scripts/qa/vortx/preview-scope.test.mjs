import test from 'node:test'
import assert from 'node:assert/strict'
import { assertPreviewDetails, manifest } from './preview-runtime.mjs'

const jwt = claims => `synthetic.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`
const details = (ref = manifest.projectRef) => ({
  SUPABASE_URL: `https://${ref}.supabase.co`,
  POSTGRES_URL: `postgresql://postgres.${ref}:synthetic@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  SUPABASE_ANON_KEY: jwt({ ref, role: 'anon' }),
  SUPABASE_SERVICE_ROLE_KEY: jwt({ ref, role: 'service_role' }),
})

test('pins the new Git branch to the reusable disposable Preview', () => {
  assert.equal(manifest.branch, 'integration/vortx-main-20261021')
  assert.equal(manifest.baseBranch, 'main')
  assert.equal(manifest.baseCommit, '344708db0236a3393bba22cff2c1adfd79f8d5c3')
  assert.equal(assertPreviewDetails(details()).SUPABASE_URL, `https://${manifest.projectRef}.supabase.co`)
})
test('rejects production and shared homolog API targets', () => {
  for (const ref of [manifest.productionRef, manifest.homologRef]) assert.throws(() => assertPreviewDetails(details(ref)), /WRONG_PREVIEW_API_TARGET/)
})
test('rejects a protected database behind an apparently correct Preview API', () => {
  for (const ref of [manifest.productionRef, manifest.homologRef]) assert.throws(() => assertPreviewDetails({ ...details(), POSTGRES_URL: details(ref).POSTGRES_URL }), /WRONG_PREVIEW_DATABASE_TARGET/)
})
test('rejects an unrelated database host even with the right project in its username', () => {
  assert.throws(() => assertPreviewDetails({ ...details(), POSTGRES_URL: details().POSTGRES_URL.replace('aws-0-us-east-1.pooler.supabase.com', 'unrelated.example.invalid') }), /WRONG_PREVIEW_DATABASE_TARGET/)
})
test('rejects credentials or query parameters embedded in the Preview API URL', () => {
  assert.throws(() => assertPreviewDetails({ ...details(), SUPABASE_URL: `https://synthetic:synthetic@${manifest.projectRef}.supabase.co` }), /INVALID_PREVIEW_API_URL/)
  assert.throws(() => assertPreviewDetails({ ...details(), SUPABASE_URL: `${details().SUPABASE_URL}?unexpected=1` }), /INVALID_PREVIEW_API_URL/)
})
test('rejects production keys hidden behind Preview URLs', () => {
  for (const key of ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) assert.throws(() => assertPreviewDetails({ ...details(), [key]: details(manifest.productionRef)[key] }), /WRONG_PREVIEW_KEY_TARGET/)
})
test('rejects swapped anon and administrative key roles', () => {
  assert.throws(() => assertPreviewDetails({ ...details(), SUPABASE_ANON_KEY: details().SUPABASE_SERVICE_ROLE_KEY }), /WRONG_PREVIEW_KEY_ROLE/)
})
test('does not permit automatic replay, production writes, keyring reuse or real remittance submission', () => {
  assert.equal(manifest.migrationMode, 'NO_AUTOMATIC_REPLAY')
  assert.equal(manifest.productionDatabaseWritesAllowed, false)
  assert.equal(manifest.productionDecryptionKeyReuseAllowed, false)
  assert.equal(manifest.newRealRemittanceSubmissionAllowed, false)
  assert.equal(manifest.preserveExistingQaData, true)
})
