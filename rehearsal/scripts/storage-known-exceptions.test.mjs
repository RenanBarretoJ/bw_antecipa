import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateStorageExceptionGate,
  loadStorageExceptionsManifest,
  validateStorageExceptionsManifest,
} from './storage-known-exceptions.mjs'

const manifest = loadStorageExceptionsManifest()

function actualFrom(exception, overrides = {}) {
  return {
    object_id: exception.object_id,
    bucket_id: exception.bucket,
    fingerprint_sha256: exception.fingerprint_sha256,
    content_etag: exception.content_etag,
    content_type: exception.content_type,
    size_bytes: exception.size_bytes,
    bucket_public: false,
    owner_profile_status: 'ativo',
    owner_profile_role: 'cedente',
    cedente_status: 'ativo',
    path_matches_cedente: true,
    dlz_active_links: 1,
    other_fund_active_links: 0,
    references: 0,
    ...overrides,
  }
}

test('aceita somente as duas excecoes explicitamente certificadas', () => {
  const result = evaluateStorageExceptionGate({
    manifest,
    unreferencedObjects: manifest.exceptions.map((exception) => actualFrom(exception)),
  })
  assert.equal(result.passed, true)
  assert.equal(result.code, 'KNOWN_EXCEPTIONS_ONLY')
  assert.equal(result.known_count, 2)
})

test('terceiro objeto sem referencia falha fechado', () => {
  const third = actualFrom(manifest.exceptions[0], {
    object_id: '6e5556a5-b76f-4a67-9e46-ec4b83be577f',
    fingerprint_sha256: 'a'.repeat(64),
  })
  const result = evaluateStorageExceptionGate({
    manifest,
    unreferencedObjects: [...manifest.exceptions.map((exception) => actualFrom(exception)), third],
  })
  assert.equal(result.passed, false)
  assert.equal(result.code, 'UNKNOWN_UNREFERENCED_STORAGE')
})

test('fingerprint divergente nao herda a excecao pelo object id', () => {
  const objects = manifest.exceptions.map((exception) => actualFrom(exception))
  objects[0].fingerprint_sha256 = 'b'.repeat(64)
  const result = evaluateStorageExceptionGate({ manifest, unreferencedObjects: objects })
  assert.equal(result.passed, false)
  assert.equal(result.code, 'UNKNOWN_UNREFERENCED_STORAGE')
})

test('objeto ausente ou publicamente exposto invalida o gate', () => {
  const missing = evaluateStorageExceptionGate({
    manifest,
    unreferencedObjects: [actualFrom(manifest.exceptions[0])],
  })
  assert.equal(missing.code, 'KNOWN_EXCEPTION_MISSING')

  const exposed = manifest.exceptions.map((exception) => actualFrom(exception))
  exposed[1].bucket_public = true
  const invalid = evaluateStorageExceptionGate({ manifest, unreferencedObjects: exposed })
  assert.equal(invalid.code, 'KNOWN_EXCEPTION_INVALID')
})

test('manifesto nao aceita wildcard nem quantidade implicita', () => {
  const unsafe = structuredClone(manifest)
  unsafe.exceptions[0].fingerprint_sha256 = '*'
  assert.throws(() => validateStorageExceptionsManifest(unsafe), /Fingerprint/u)
})
