import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { assertExpectedCounts, verifyCloneBase } from './rollback-drill-local.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('validador exige todos os volumes certificados', () => {
  assert.equal(assertExpectedCounts({
    cedentes: 12,
    operacoes: 46,
    notas_fiscais: 910,
    documentos: 123,
    storage_objects: 1644,
    auth_users: 23,
    profiles: 23,
    operacoes_fromtis_legado: 26,
  }), true)
  assert.throws(() => assertExpectedCounts({ cedentes: 11 }), /cedentes/u)
})

test('clone-base possui manifesto e checksums validos', () => {
  const clone = verifyCloneBase()
  assert.match(clone.manifest_sha256, /^[a-f0-9]{64}$/u)
  assert.equal(clone.artifacts.length, 4)
  assert.ok(clone.artifacts.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256)))
})

test('script de drill possui guard local e compensacao', () => {
  const source = fs.readFileSync(path.join(ROOT, 'rehearsal/p4-7/rollback-drill-local.mjs'), 'utf8')
  const restore = fs.readFileSync(path.join(ROOT, 'rehearsal/scripts/restore-local.mjs'), 'utf8')
  assert.match(source, /assertLocalTarget\(\)/u)
  assert.match(source, /127\.0\.0\.1|local-only/u)
  assert.match(source, /Compensacao local executada/u)
  assert.doesNotMatch(source, /wwsndnuvnjuabpbjwlck|fhgkmggthxikfpogrvaa/u)
  assert.match(restore, /localAdmin[\s\S]*user: 'supabase_admin'/u)
  assert.match(restore, /withPgClient\(localAdmin,[\s\S]*drop schema if exists private cascade; drop schema if exists public cascade/u)
  assert.match(restore, /production-auth-sanitized\.sql'[\s\S]*connection: localAdmin/u)
  const schemaDrop = restore.indexOf("await client.query('drop schema if exists private cascade; drop schema if exists public cascade')")
  const authRestore = restore.indexOf("console.log('Restaurando Auth sanitizado no rehearsal local...')")
  assert.ok(
    schemaDrop >= 0 && authRestore >= 0 && schemaDrop < authRestore,
    'schema public deve ser removido antes do TRUNCATE CASCADE de Auth',
  )
})
