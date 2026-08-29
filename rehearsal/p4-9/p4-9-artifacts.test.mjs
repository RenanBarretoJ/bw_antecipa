import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const APP_HASH = '60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666'
const CUTOVER_HASH = 'dc7ef0d88a4dbde49107b62a30a906dcc675de6ae6ed3e9f274f6b2529289a90'

test('P4.9 fecha SMTP Auth, delivery e gate final', () => {
  const report = read('docs/homologacao/p4-9-final-gate.md')
  for (const flag of [
    'SUPABASE_AUTH_SMTP_READY = PASS',
    'AUTH_EMAIL_DELIVERY_TEST = PASS',
    'AUTH_FINAL_READY = PASS',
    'PRODUCTION_BASELINE = STABLE',
    'APP_RELEASE_HASH_READY = PASS',
    'CUTOVER_BUNDLE_HASH_READY = PASS',
    'RC_FREEZE_PLAN = READY',
    'RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO',
    'P4_9_FINAL_GATE = PASS',
    'CUTOVER_PRODUCAO = GO_CONDICIONAL_COMMIT',
  ]) assert.match(report, new RegExp(flag, 'u'))
})

test('baseline permanece canonica depois do SMTP Auth', () => {
  const baseline = JSON.parse(read('docs/homologacao/p4-baseline-producao-read-only.json'))
  assert.equal(baseline.counts.operacoes, 46)
  assert.equal(baseline.counts.notas_fiscais, 910)
  assert.equal(baseline.counts.storage_objects, 1644)
  assert.equal(baseline.counts.auth_users, 23)
  assert.equal(baseline.counts.profiles, 23)
  assert.equal(baseline.auth_smtp_configuration_impact, 'configuration_only_counts_stable')
  assert.ok(Object.values(baseline.integrity).every((value) => value === 0))
})

test('canal local nao aceita segredo em argumento e remove credencial apos uso', () => {
  const credential = read('rehearsal/p4-9/smtp-auth-credential.ps1')
  const configure = read('rehearsal/p4-8/configure-auth-smtp-from-vercel.ps1')
  assert.match(credential, /Read-Host 'SMTP_PASSWORD[^']*' -AsSecureString/u)
  assert.match(credential, /CredWrite/u)
  assert.match(credential, /CredDelete/u)
  const parameterBlock = credential.match(/^param\(([\s\S]*?)\)\r?\n/u)?.[1] ?? ''
  assert.doesNotMatch(parameterBlock, /Password/iu)
  assert.match(configure, /smtp-auth-credential\.ps1'\) -Remove/u)
  assert.match(configure, /Remove-Item -LiteralPath/u)
})

test('recovery smoke usa endpoint oficial uma vez e nao registra token ou link', () => {
  const recovery = read('rehearsal/p4-9/recovery-smoke.ps1')
  assert.match(recovery, /\/auth\/v1\/recover/u)
  assert.match(recovery, /UseBasicParsing/u)
  assert.match(recovery, /redirect_host/u)
  assert.match(recovery, /recipient_fingerprint/u)
  assert.doesNotMatch(recovery, /while\s*\(|for\s*\(/u)
})

test('hashes APP e CUTOVER permanecem canonicos', () => {
  const manifest = JSON.parse(read('rehearsal/manifests/release-scopes.json'))
  assert.equal(manifest.app_release.hash, APP_HASH)
  assert.equal(manifest.cutover_bundle.hash, CUTOVER_HASH)
  assert.equal(manifest.app_release.files, 724)
  assert.equal(manifest.cutover_bundle.files, 20)
})

test('artefatos P4.9 nao contem credenciais ou links Auth completos', () => {
  const content = [
    read('docs/homologacao/p4-9-final-gate.md'),
    read('rehearsal/p4-9/smtp-auth-credential.ps1'),
    read('rehearsal/p4-9/recovery-smoke.ps1'),
  ].join('\n')
  assert.doesNotMatch(content, /sb_secret_[A-Za-z0-9_-]+/u)
  assert.doesNotMatch(content, /postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/u)
  assert.doesNotMatch(content, /token_hash=[A-Za-z0-9_-]+/u)
  assert.doesNotMatch(content, /(?:SMTP_PASSWORD|FROMTIS_PASSWORD)\s*=\s*[^\s<]+/u)
})
