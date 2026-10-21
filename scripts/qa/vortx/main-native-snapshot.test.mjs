import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { decodeSnapshot, sha256 } from './main-native-snapshot.mjs'

const manifest = JSON.parse(readFileSync(new URL('./main-integration-manifest.json', import.meta.url), 'utf8'))
const text = readFileSync(manifest.nativeSnapshot.path, 'utf8')
const payload = decodeSnapshot(text, manifest.nativeSnapshot.sha256)
const pack = value => {
  const bytes = Buffer.from(JSON.stringify(value))
  const content = JSON.stringify({ format: 'BW_NATIVE_QA_SCHEMA_ONLY_V1', payloadSha256: sha256(bytes), gzipBase64: gzipSync(bytes).toString('base64') })
  return [content, sha256(content)]
}
test('versioned local-only snapshot verifies without a source container', () => {
  assert.equal(payload.sourceKind, 'LOCAL_SCHEMA_ONLY_NO_APPLICATION_DATA')
  assert.equal(payload.functions.length, 7)
})
test('any byte change is rejected before Docker provisioning', () => {
  assert.throws(() => decodeSnapshot(text + ' ', manifest.nativeSnapshot.sha256), /VERSIONED_NATIVE_SNAPSHOT_HASH_DRIFT/)
})
test('business records in either SQL segment are rejected', () => {
  const value = { ...payload, schema: payload.schema + '\nINSERT INTO public.profiles VALUES (1);' }
  value.schemaSha256 = sha256(value.schema)
  assert.throws(() => decodeSnapshot(...pack(value)), /SCHEMA_ONLY_REQUIRED/)
  for (const statement of ['INSERT INTO public.profiles VALUES (1);', 'COPY auth.users FROM stdin;']) {
    const value = { ...payload, platformHistory: payload.platformHistory + '\n' + statement }
    value.platformHistorySha256 = sha256(value.platformHistory)
    assert.throws(() => decodeSnapshot(...pack(value)), /ONLY_NATIVE_PLATFORM_MIGRATION_METADATA_ALLOWED|UNEXPECTED_DATA_COPY_REFUSED/)
  }
})
test('role passwords and foreign images cannot enter the bootstrap', () => {
  assert.throws(() => decodeSnapshot(...pack({ ...payload, roles: [{ ...payload.roles[0], password: 'synthetic' }] })))
  assert.throws(() => decodeSnapshot(...pack({ ...payload, image: 'unrelated/custom-postgres:latest' })))
})
