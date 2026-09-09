import fs from 'node:fs'
import path from 'node:path'
import { REHEARSAL_ROOT } from './lib.mjs'

export const STORAGE_EXCEPTIONS_MANIFEST_PATH = path.join(
  REHEARSAL_ROOT,
  'manifests',
  'p5-5-storage-known-exceptions.json',
)

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const HASH_PATTERN = /^[0-9a-f]{64}$/u
const ETAG_PATTERN = /^[0-9a-f]{32}$/u

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function validateStorageExceptionsManifest(manifest) {
  assert(manifest?.schema_version === 1, 'Versao do manifesto de excecoes Storage invalida.')
  assert(manifest.release === 'P5_5_STORAGE_KNOWN_EXCEPTIONS', 'Release do manifesto de excecoes invalida.')
  assert(manifest.environment === 'production', 'Manifesto de excecoes deve declarar production.')
  assert(manifest.project_ref === 'wwsndnuvnjuabpbjwlck', 'Project ref do manifesto de excecoes invalido.')
  assert(manifest.context === 'DLZ_HEALTH', 'Contexto da excecao Storage invalido.')
  assert(manifest.classification === 'KNOWN_UNREFERENCED_STORAGE', 'Classificacao da excecao Storage invalida.')
  assert(manifest.decision === 'PRESERVAR', 'Decisao da excecao Storage invalida.')
  assert(UUID_PATTERN.test(manifest.correlation_id), 'Correlation id da excecao Storage invalido.')
  assert(manifest.review?.required === true, 'Revisao futura da excecao Storage deve ser obrigatoria.')
  assert(Number.isInteger(manifest.scope?.expected_storage_objects), 'Baseline de Storage invalida.')
  assert(manifest.scope.expected_baseline?.storage_objects === manifest.scope.expected_storage_objects, 'Contagem de Storage diverge da baseline P5.5.')
  assert(Array.isArray(manifest.exceptions), 'Lista de excecoes Storage ausente.')
  assert(manifest.exceptions.length === manifest.scope.expected_known_exceptions, 'Quantidade declarada de excecoes diverge da lista.')
  assert(manifest.exceptions.length === 2, 'P5.5 certifica exatamente duas excecoes Storage.')

  const ids = new Set()
  const fingerprints = new Set()
  for (const exception of manifest.exceptions) {
    assert(UUID_PATTERN.test(exception.object_id), 'Object id de excecao Storage invalido.')
    assert(HASH_PATTERN.test(exception.fingerprint_sha256), 'Fingerprint de excecao Storage invalido.')
    assert(ETAG_PATTERN.test(exception.content_etag), 'ETag de excecao Storage invalido.')
    assert(exception.bucket === 'notas-fiscais', 'Bucket nao certificado no manifesto de excecoes Storage.')
    assert(exception.content_type === 'image/jpeg', 'Content type nao certificado no manifesto de excecoes Storage.')
    assert(Number.isInteger(exception.size_bytes) && exception.size_bytes > 0, 'Tamanho da excecao Storage invalido.')
    assert(!ids.has(exception.object_id), 'Object id duplicado no manifesto de excecoes Storage.')
    assert(!fingerprints.has(exception.fingerprint_sha256), 'Fingerprint duplicado no manifesto de excecoes Storage.')
    ids.add(exception.object_id)
    fingerprints.add(exception.fingerprint_sha256)
  }
  return manifest
}

export function loadStorageExceptionsManifest() {
  return validateStorageExceptionsManifest(JSON.parse(fs.readFileSync(STORAGE_EXCEPTIONS_MANIFEST_PATH, 'utf8')))
}

function normalizedEtag(value) {
  return String(value ?? '').replaceAll('"', '')
}

function exceptionIsEligible(actual, expected) {
  return actual.object_id === expected.object_id
    && actual.bucket_id === expected.bucket
    && actual.fingerprint_sha256 === expected.fingerprint_sha256
    && normalizedEtag(actual.content_etag) === expected.content_etag
    && actual.content_type === expected.content_type
    && Number(actual.size_bytes) === expected.size_bytes
    && actual.bucket_public === false
    && actual.owner_profile_status === 'ativo'
    && actual.owner_profile_role === 'cedente'
    && actual.cedente_status === 'ativo'
    && actual.path_matches_cedente === true
    && Number(actual.dlz_active_links) === 1
    && Number(actual.other_fund_active_links) === 0
    && Number(actual.references) === 0
}

export function evaluateStorageExceptionGate({ unreferencedObjects, manifest }) {
  validateStorageExceptionsManifest(manifest)
  const expectedById = new Map(manifest.exceptions.map((exception) => [exception.object_id, exception]))
  const actualById = new Map(unreferencedObjects.map((object) => [object.object_id, object]))
  const unknown = unreferencedObjects.filter((object) => {
    const expected = expectedById.get(object.object_id)
    return !expected || expected.fingerprint_sha256 !== object.fingerprint_sha256
  })
  const missing = manifest.exceptions.filter((exception) => !actualById.has(exception.object_id))
  const invalid = manifest.exceptions.filter((exception) => {
    const actual = actualById.get(exception.object_id)
    return actual && !exceptionIsEligible(actual, exception)
  })

  return {
    passed: unknown.length === 0 && missing.length === 0 && invalid.length === 0,
    code: unknown.length > 0
      ? 'UNKNOWN_UNREFERENCED_STORAGE'
      : missing.length > 0
        ? 'KNOWN_EXCEPTION_MISSING'
        : invalid.length > 0
          ? 'KNOWN_EXCEPTION_INVALID'
          : 'KNOWN_EXCEPTIONS_ONLY',
    expected_count: manifest.exceptions.length,
    actual_count: unreferencedObjects.length,
    known_count: unreferencedObjects.length - unknown.length,
    unknown_object_ids: unknown.map((object) => object.object_id),
    missing_object_ids: missing.map((exception) => exception.object_id),
    invalid_object_ids: invalid.map((exception) => exception.object_id),
  }
}
