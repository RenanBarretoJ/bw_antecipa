import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import pg from 'pg'
import { previewDetails, assertPreviewDetails, manifest } from '../vortx/preview-runtime.mjs'

export async function connectDuplicatasPreview() {
  assert.equal(manifest.projectRef, 'phdckowbexkkvuwnzeaf')
  const details = assertPreviewDetails(previewDetails())
  const response = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { redirect: 'error', signal: AbortSignal.timeout(15000) })
  assert(response.ok, 'CA_DOWNLOAD_FAILED')
  const ca = await response.text(), cert = new X509Certificate(ca)
  assert(cert.ca && cert.verify(cert.publicKey) && Date.parse(cert.validTo) > Date.now())
  assert.equal(cert.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')
  const connection = new URL(details.POSTGRES_URL)
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) connection.searchParams.delete(key)
  const db = new pg.Client({ connectionString: connection.toString(), ssl: { ca, rejectUnauthorized: true, servername: connection.hostname }, connectionTimeoutMillis: 20000 })
  await db.connect()
  await db.query("set default_transaction_read_only=on;set statement_timeout='30s';set lock_timeout='3s'")
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations where version=$1', [manifest.originalA6Version])).rows[0].n, 0)
  return { db, details }
}
