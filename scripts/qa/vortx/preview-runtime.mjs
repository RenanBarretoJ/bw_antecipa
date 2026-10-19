import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import pg from 'pg'

export const manifest = JSON.parse(readFileSync(new URL('./preview-manifest.json', import.meta.url), 'utf8'))
export const repository = fileURLToPath(new URL('../../../', import.meta.url))

export function assertPreviewDetails(details) {
  const api = new URL(details.SUPABASE_URL)
  assert.equal(api.origin, `https://${manifest.projectRef}.supabase.co`, 'WRONG_PREVIEW_API_TARGET')
  assert(!api.username && !api.password && !api.search && !api.hash && api.pathname === '/', 'INVALID_PREVIEW_API_URL')
  assert(![manifest.productionRef, manifest.homologRef].includes(manifest.projectRef), 'PROTECTED_PROJECT_AS_PREVIEW')
  const database = new URL(details.POSTGRES_URL)
  assert(['postgres:', 'postgresql:'].includes(database.protocol), 'INVALID_PREVIEW_DATABASE_PROTOCOL')
  assert(database.hostname === `db.${manifest.projectRef}.supabase.co`
    || (database.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(database.username) === `postgres.${manifest.projectRef}`), 'WRONG_PREVIEW_DATABASE_TARGET')
  for (const [key, role] of [['SUPABASE_ANON_KEY', 'anon'], ['SUPABASE_SERVICE_ROLE_KEY', 'service_role']]) {
    // Provider-returned JWT metadata verifies the target; it is not used as an authorization decision.
    const claims = JSON.parse(Buffer.from(details[key].split('.')[1], 'base64url').toString('utf8'))
    assert.equal(claims.ref, manifest.projectRef, 'WRONG_PREVIEW_KEY_TARGET')
    assert.equal(claims.role, role, 'WRONG_PREVIEW_KEY_ROLE')
  }
  return details
}

export function previewDetails() {
  const branch = spawnSync('git', ['branch', '--show-current'], { cwd: repository, encoding: 'utf8', windowsHide: true })
  assert.equal(branch.status, 0, 'GIT_CONTEXT_FAILED')
  assert.equal(branch.stdout.trim(), manifest.branch, 'WRONG_GIT_BRANCH')
  const result = spawnSync(process.execPath, [resolve(repository, 'node_modules/supabase/dist/supabase.js'), 'branches', 'get', manifest.supabaseBranchId, '--project-ref', manifest.productionRef, '-o', 'json'], {
    cwd: repository, encoding: 'utf8', windowsHide: true, timeout: 60000,
  })
  assert.equal(result.status, 0, 'PREVIEW_LOOKUP_FAILED_NO_RAW_OUTPUT')
  return assertPreviewDetails(JSON.parse(result.stdout))
}

export async function connectReadOnlyPreview(details = previewDetails()) {
  assertPreviewDetails(details)
  const db = new pg.Client({ connectionString: details.POSTGRES_URL, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 20000 })
  await db.connect()
  try {
    await db.query("SET default_transaction_read_only = on; SET statement_timeout = '15s'; SET lock_timeout = '3s'")
    const a6 = await db.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations WHERE version = $1', [manifest.originalA6Version])
    assert.equal(a6.rows[0].n, 0, 'ORIGINAL_A6_MUST_REMAIN_UNAPPLIED')
    return db
  } catch (error) {
    await db.end()
    throw error
  }
}
