import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const preflightPath = path.join(repositoryRoot, 'docs', 'homologacao', 'sql', 'p4-preflight-producao-read-only.sql')
const postflightPath = path.join(repositoryRoot, 'docs', 'homologacao', 'sql', 'p4-postflight-producao-read-only.sql')
const manifestPath = path.join(repositoryRoot, 'rehearsal', 'manifests', 'production-migrations.json')

function sql(file) {
  return fs.readFileSync(file, 'utf8')
}

function executableSql(value) {
  return value
    .replace(/--.*$/gmu, '')
    .replace(/'([^']|'')*'/gu, "''")
}

function assertReadOnly(value) {
  const executable = executableSql(value)
  assert.match(executable, /begin\s+transaction\s+read\s+only/iu)
  assert.match(executable, /rollback\s*;/iu)
  assert.doesNotMatch(executable, /\b(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|call|do)\b/iu)
}

test('preflight e postflight sao protegidos por transacao read-only', () => {
  assertReadOnly(sql(preflightPath))
  assertReadOnly(sql(postflightPath))
})

test('preflight cobre baseline, delta, patch DLZ, integridade, policies, Storage e Auth', () => {
  const value = sql(preflightPath)
  for (const expected of [
    '2026-08-27 18:25:50.037+00',
    '382fab89-936b-4ff9-b4fe-edbfab0fa7f4',
    'c3df4597-25a8-4b50-ae83-fadada7170e4',
    'supabase_migrations.schema_migrations',
    'pg_policies',
    'storage.objects',
    'auth.users',
  ]) assert.match(value, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
})

test('postflight cobre cadeia canonica, exclusoes, DLZ, CNAB, integracao e grants', () => {
  const value = sql(postflightPath)
  for (const expected of [
    'total_migrations_confere',
    '20260723182639',
    '20260827205000',
    'd1311000-0000-4000-8000-000000000002',
    'd1312000-0000-4000-8000-000000000002',
    'd1313000-0000-4000-8000-000000000002',
    'legacy_env_sinqia_terra',
    'on_auth_user_created',
    'notificacoes_own_update',
  ]) assert.match(value, new RegExp(expected, 'u'))
})

test('manifesto permanece na topologia certificada do P4', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.baseline_existing.length, 14)
  assert.equal(manifest.pre_upgrade_bridges.length, 3)
  assert.equal(manifest.upgrade_order.length, 175)
  assert.equal(manifest.post_upgrade_data_patches.length, 1)
  assert.equal(manifest.blocked_homolog_only.length, 5)
  assert.equal(manifest.manifest_hash, 'cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318')
})
