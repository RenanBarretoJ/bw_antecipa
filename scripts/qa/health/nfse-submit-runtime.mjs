// Isolated QA boundary: no caller-supplied project, database or branch identifiers.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import pg from 'pg'

export const ref = 'ettpaprrmpjsfkcystob'
export const branch = 'hotfix/nfse-submit-frozen-facts'
export const base = 'https://bw-antecipa-git-hotfix-nfse-submit-frozen-facts-renanbarretoj.vercel.app'
assert.equal(spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).stdout.trim(), branch)
export function details() {
  const r = spawnSync(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), 'branches', 'get', '8d126d13-396d-47f0-bfc4-12d8a3eba8e6', '--project-ref', 'wwsndnuvnjuabpbjwlck', '-o', 'json'], { encoding: 'utf8', windowsHide: true, timeout: 60000 })
  assert.equal(r.status, 0, 'PREVIEW_LOOKUP_FAILED')
  const d = JSON.parse(r.stdout)
  assert.equal(new URL(d.SUPABASE_URL).hostname, `${ref}.supabase.co`)
  const url = new URL(d.POSTGRES_URL)
  assert(url.hostname === `db.${ref}.supabase.co` || decodeURIComponent(url.username).endsWith(`.${ref}`))
  return d
}
export async function connect(d) {
  const db = new pg.Client({ connectionString: d.POSTGRES_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 })
  await db.connect()
  assert.equal(Number((await db.query('select count(*) n from supabase_migrations.schema_migrations')).rows[0].n), 0, 'HISTORY_MUST_REMAIN_UNCHANGED')
  return db
}
const directory = join(homedir(), '.codex', 'tmp', 'nfse-submit-20261005')
export const secretFile = join(directory, 'qa-credentials.dpapi')
function powershell(command, input) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { input, encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 0, 'QA_DPAPI_FAILED'); return r.stdout.trim()
}
export function saveCredentials(value) {
  mkdirSync(directory, { recursive: true })
  const encrypted = powershell('$v=[Console]::In.ReadToEnd(); ConvertTo-SecureString -String $v -AsPlainText -Force | ConvertFrom-SecureString', JSON.stringify(value))
  writeFileSync(secretFile, encrypted)
}
export function loadCredentials() {
  const plain = powershell('$s=ConvertTo-SecureString ([Console]::In.ReadToEnd()); $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }', readFileSync(secretFile, 'utf8'))
  const state = JSON.parse(plain); assert.equal(state.ref, ref); return state
}
