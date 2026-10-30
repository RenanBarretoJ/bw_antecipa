import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DOCUMENT_TYPES, PREVIEW_REF, MAX_BYTES, insertMissingDocumentTypes, ensurePrivateBuckets } from './contract.mjs'

test('canonical catalog matches the original reviewed seed, without historical migration changes', () => {
  const sql = fs.readFileSync(new URL('../../../../supabase/migrations/20260722193500_corrigir_catalogo_documental_requisitos_nf.sql', import.meta.url), 'utf8')
  for (const row of DOCUMENT_TYPES) {
    const tuple = `('${row.codigo}', '${row.nome}', 'nf', ARRAY[${row.mime_types_aceitos.map(x => `'${x}'`).join(', ')}], ARRAY[${row.extensoes_aceitas.map(x => `'${x}'`).join(', ')}], ${MAX_BYTES}, true, true)`
    assert.ok(sql.includes(tuple), 'CANONICAL_SEED_MISMATCH')
  }
})
test('production, homolog and the old Preview are rejected before any request', async () => {
  for (const ref of ['wwsndnuvnjuabpbjwlck', 'fhgkmggthxikfpogrvaa', 'phdckowbexkkvuwnzeaf', undefined]) {
    const denied = () => { throw Error('REQUEST_MUST_NOT_HAPPEN') }
    await assert.rejects(insertMissingDocumentTypes({ query: denied }, ref), /EXCLUSIVE_SERPRO_PREVIEW/)
    await assert.rejects(ensurePrivateBuckets({ listBuckets: denied }, ref), /EXCLUSIVE_SERPRO_PREVIEW/)
  }
})
test('reference drift is negative control, not blind ON CONFLICT', async () => {
  const db = { query: async sql => { assert.match(sql, /^SELECT /); return { rows: [{ ...DOCUMENT_TYPES[0], ativo: false }] } } }
  await assert.rejects(insertMissingDocumentTypes(db, PREVIEW_REF), /REFERENCE_DOCUMENT_DRIFT/)
})
test('bucket provisioning stays private, bounded and idempotent through the official API', async () => {
  const buckets = [], created = []
  const storage = { listBuckets: async () => ({ data: buckets, error: null }),
    createBucket: async (id, options) => { assert.deepEqual(options, { public: false, fileSizeLimit: MAX_BYTES }); created.push(id); buckets.push({ id, name: id, public: false, file_size_limit: MAX_BYTES }); return { error: null } },
    getBucket: async id => ({ data: buckets.find(b => b.id === id), error: null }) }
  assert.deepEqual((await ensurePrivateBuckets(storage, PREVIEW_REF)).created, ['documentos-v2', 'notas-fiscais'])
  assert.deepEqual((await ensurePrivateBuckets(storage, PREVIEW_REF)).created, [])
  assert.equal(created.length, 2)
})
test('unexpected public or undersized bucket stops without rewriting or creating others', async () => {
  for (const override of [{ public: true }, { file_size_limit: 1 }, { allowed_mime_types: ['application/pdf'] }]) {
    await assert.rejects(ensurePrivateBuckets({ listBuckets: async () => ({ data: [{ id: 'documentos-v2', name: 'documentos-v2', public: false, ...override }], error: null }), createBucket: () => { throw Error('MUST_NOT_CREATE') } }, PREVIEW_REF))
  }
})
