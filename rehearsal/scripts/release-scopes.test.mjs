import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  RELEASE_SCOPES_MANIFEST,
  canonicalAppFiles,
  canonicalCutoverFiles,
  verifyReleaseScopes,
} from './release-scopes.mjs'

test('APP_RELEASE possui escopo material e exclui evidencias e testes', () => {
  const files = canonicalAppFiles()
  assert.ok(files.includes('package.json'))
  assert.ok(files.includes('src/lib/integracoes/legacy-env.ts'))
  assert.ok(files.includes('supabase/migrations/20260827183411_bridge_consultor_cedentes_para_consultor_cedente.sql'))
  assert.ok(files.includes('supabase/migrations/20260827203000_p2_runtime_compatibilidade_sacado_admin.sql'))
  assert.ok(files.includes('supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql'))
  assert.equal(files.some((file) => file.startsWith('docs/')), false)
  assert.equal(files.some((file) => file.startsWith('rehearsal/')), false)
  assert.equal(files.some((file) => /\.(?:test|spec)\.[^.]+$/u.test(file)), false)
})

test('CUTOVER_BUNDLE e uma allowlist operacional explicita', () => {
  const files = canonicalCutoverFiles()
  for (const expected of [
    'rehearsal/manifests/production-migrations.json',
    'rehearsal/manifests/dlz-production-config.json',
    'rehearsal/scripts/configure-dlz-production.mjs',
    'docs/homologacao/sql/p4-preflight-producao-read-only.sql',
    'docs/homologacao/sql/p4-postflight-producao-read-only.sql',
    'docs/homologacao/p3-runbook-cutover-producao.md',
    'docs/homologacao/p3-runbook-rollback-producao.md',
  ]) assert.ok(files.includes(expected))
  assert.equal(files.some((file) => file.includes('p4-3-infra')), false)
  assert.equal(files.some((file) => file.endsWith('.test.mjs')), false)
})

test('manifesto persistido possui listas e hashes reproduziveis', () => {
  assert.ok(fs.existsSync(RELEASE_SCOPES_MANIFEST))
  const verified = verifyReleaseScopes()
  assert.match(verified.app_release.hash, /^[a-f0-9]{64}$/u)
  assert.match(verified.cutover_bundle.hash, /^[a-f0-9]{64}$/u)
  assert.ok(verified.app_release.entries.length > verified.cutover_bundle.entries.length)
})

