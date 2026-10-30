import assert from 'node:assert/strict'

export const PREVIEW_REF = 'fgttffyrkabpycmbnppi'
export const MAX_BYTES = 20 * 1024 * 1024
export const DOCUMENT_TYPES = Object.freeze([
  Object.freeze({ codigo: 'nf_xml', nome: 'XML da NF-e', dominio: 'nf',
    mime_types_aceitos: ['application/xml', 'text/xml', 'application/octet-stream'], extensoes_aceitas: ['xml'],
    tamanho_max_bytes: MAX_BYTES, permite_multiplas_versoes: true, ativo: true }),
  Object.freeze({ codigo: 'nf_danfe_pdf', nome: 'DANFE em PDF', dominio: 'nf',
    mime_types_aceitos: ['application/pdf'], extensoes_aceitas: ['pdf'],
    tamanho_max_bytes: MAX_BYTES, permite_multiplas_versoes: true, ativo: true }),
])
export const BUCKETS = Object.freeze(['documentos-v2', 'notas-fiscais'])

export function assertPreview(ref) {
  assert.equal(ref, PREVIEW_REF, 'EXCLUSIVE_SERPRO_PREVIEW_REQUIRED')
}

export function assertCanonicalDocument(actual, expected) {
  for (const field of Object.keys(expected)) {
    const value = field === 'tamanho_max_bytes' ? Number(actual[field]) : actual[field]
    assert.deepEqual(value, expected[field], `REFERENCE_DOCUMENT_DRIFT:${expected.codigo}:${field}`)
  }
}

/** Caller owns BEGIN/COMMIT and audit. No updates, deletes, ACLs or DDL. */
export async function insertMissingDocumentTypes(db, ref) {
  assertPreview(ref)
  const fields = Object.keys(DOCUMENT_TYPES[0])
  const result = await db.query(`SELECT ${fields.join(',')} FROM public.documento_tipos WHERE codigo=ANY($1::text[]) FOR UPDATE`,
    [DOCUMENT_TYPES.map(row => row.codigo)])
  const existing = new Map(result.rows.map(row => [row.codigo, row]))
  assert.equal(existing.size, result.rows.length, 'DUPLICATE_REFERENCE_DOCUMENT')
  // Validate all existing values BEFORE adding anything. Unexpected data is not overwritten.
  for (const expected of DOCUMENT_TYPES) if (existing.has(expected.codigo)) assertCanonicalDocument(existing.get(expected.codigo), expected)
  const inserted = []
  for (const row of DOCUMENT_TYPES) {
    if (existing.has(row.codigo)) continue
    const written = await db.query(`INSERT INTO public.documento_tipos(${fields.join(',')}) VALUES(${fields.map((_, i) => `$${i + 1}`).join(',')}) RETURNING codigo`, fields.map(field => row[field]))
    assert.equal(written.rowCount, 1, 'EXACT_ONE_REFERENCE_INSERT_REQUIRED')
    inserted.push(row.codigo)
  }
  return { inserted, preserved: [...existing.keys()].sort() }
}

function assertPrivateBucket(bucket, id) {
  assert.equal(bucket.id, id, 'BUCKET_IDENTITY_MISMATCH')
  assert.equal(bucket.name, id, 'BUCKET_NAME_MISMATCH')
  assert.equal(bucket.public, false, 'PRIVATE_BUCKET_REQUIRED')
  assert.ok(bucket.file_size_limit == null || Number(bucket.file_size_limit) >= MAX_BYTES, 'BUCKET_BELOW_20_MIB')
  if (bucket.allowed_mime_types?.length) {
    for (const mime of ['application/xml', 'application/pdf']) {
      assert.ok(bucket.allowed_mime_types.includes(mime), 'BUCKET_MIME_INCOMPATIBLE')
    }
  }
}

/** Official Storage API provisioning only; never upload test files as service_role. */
export async function ensurePrivateBuckets(storage, ref) {
  assertPreview(ref)
  const list = await storage.listBuckets()
  assert.ok(!list.error && Array.isArray(list.data), 'PREVIEW_BUCKET_INVENTORY_FAILED')
  for (const id of BUCKETS) {
    const existing = list.data.find(bucket => bucket.id === id)
    if (existing) assertPrivateBucket(existing, id)
  }
  const created = []
  for (const id of BUCKETS) {
    if (list.data.some(bucket => bucket.id === id)) continue
    const result = await storage.createBucket(id, { public: false, fileSizeLimit: MAX_BYTES })
    assert.ok(!result.error, 'PRIVATE_PREVIEW_BUCKET_CREATE_FAILED')
    created.push(id)
    const check = await storage.getBucket(id)
    assert.ok(!check.error && check.data, 'PRIVATE_PREVIEW_BUCKET_VERIFY_FAILED')
    assertPrivateBucket(check.data, id)
  }
  return { created, preserved: BUCKETS.filter(id => !created.includes(id)) }
}
