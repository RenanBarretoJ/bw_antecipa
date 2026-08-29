import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const APP_HASH = '60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666'
const CUTOVER_HASH = 'dc7ef0d88a4dbde49107b62a30a906dcc675de6ae6ed3e9f274f6b2529289a90'
const MIGRATION_HASH = 'cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318'
const DLZ_HASH = '5833541e93b9f9213c21b300771f53b47de3cf06242b7afd5fb51b5c06202d6c'

test('P4.8 recertifica baseline e rollback, mas permanece fail-closed sem SMTP Auth', () => {
  const report = read('docs/homologacao/p4-8-recertificacao-final.md')
  for (const flag of [
    'DELTA_DLZ_VALIDATED = PASS',
    'BASELINE_CANONICA = 46_910_1644_CERTIFICADA',
    'PATCH_CEDENTES_DLZ_CURRENT_STATE = PASS',
    'LATEST_BASELINE_REHEARSAL = DETERMINISTICO',
    'RESTORE_OWNER = DEFINED',
    'RTO_EVIDENCE = CONFIRMADO',
    'DB_ROLLBACK_READY = PASS',
    'SUPABASE_AUTH_SMTP_READY = PENDENTE_SECRET',
    'AUTH_EMAIL_DELIVERY_TEST = NA',
    'AUTH_FINAL_READY = FAIL',
    'PRODUCTION_BASELINE = STABLE',
    'RC_FREEZE_PLAN = READY',
    'P4_8_FINAL_READINESS = FAIL',
    'CUTOVER_PRODUCAO = NO_GO',
  ]) assert.match(report, new RegExp(flag, 'u'))
})

test('snapshot e delta sanitizados representam a baseline canonica', () => {
  const baseline = JSON.parse(read('docs/homologacao/p4-baseline-producao-read-only.json'))
  const delta = JSON.parse(read('docs/homologacao/p4-8-delta-baseline-read-only.json'))
  assert.equal(baseline.counts.cedentes, 12)
  assert.equal(baseline.counts.operacoes, 46)
  assert.equal(baseline.counts.notas_fiscais, 910)
  assert.equal(baseline.counts.documentos, 123)
  assert.equal(baseline.counts.storage_objects, 1644)
  assert.equal(baseline.counts.auth_users, 23)
  assert.equal(baseline.counts.profiles, 23)
  assert.equal(baseline.counts.fromtis_historico, 26)
  assert.equal(delta.classification, 'RECERTIFICADA_DLZ')
  assert.equal(delta.invoices.length, 7)
  assert.equal(delta.storage.new_objects, 9)
  assert.equal(delta.checks.impulse_records, 0)
  assert.equal(delta.checks.critical_orphans, 0)
  assert.equal(delta.secrets_included, false)
})

test('runbooks formalizam owner, autoridade e RTO de 30 minutos', () => {
  const cutover = read('docs/homologacao/p3-runbook-cutover-producao.md')
  const rollback = read('docs/homologacao/p3-runbook-rollback-producao.md')
  assert.match(cutover, /usu[aá]rio respons[aá]vel pelo cutover/iu)
  assert.match(rollback, /usu[aá]rio respons[aá]vel pelo cutover/iu)
  assert.match(rollback, /30 minutos/iu)
  assert.match(rollback, /toda a janela/iu)
  assert.match(rollback, /autoridade/iu)
})

test('SMTP tooling usa ambiente seguro e falha antes do PATCH quando o secret e protegido', () => {
  const loader = read('rehearsal/p4-8/configure-auth-smtp-from-vercel.ps1')
  const config = read('rehearsal/p4-5/supabase-auth-config.ps1')
  assert.match(loader, /\[SENSITIVE\]/u)
  assert.match(loader, /Remove-Item -LiteralPath/u)
  assert.match(config, /SetSmtpFromEnvironment/u)
  assert.match(config, /smtp_admin_email/u)
  assert.match(config, /smtp_pass/u)
  assert.match(config, /O host SMTP autorizado deve pertencer ao provedor IONOS/u)
})

test('hashes atuais preservam APP_RELEASE e versionam cutover e DLZ', () => {
  const report = read('docs/homologacao/p4-8-recertificacao-final.md')
  const manifest = JSON.parse(read('rehearsal/manifests/release-scopes.json'))
  assert.equal(manifest.app_release.hash, APP_HASH)
  assert.equal(manifest.cutover_bundle.hash, CUTOVER_HASH)
  assert.equal(manifest.app_release.files, 724)
  assert.equal(manifest.cutover_bundle.files, 20)
  for (const hash of [APP_HASH, CUTOVER_HASH, MIGRATION_HASH, DLZ_HASH]) {
    assert.match(report, new RegExp(hash, 'u'))
  }
})

test('artefatos P4.8 nao contem credenciais', () => {
  const content = [
    read('docs/homologacao/p4-8-recertificacao-final.md'),
    read('docs/homologacao/p4-8-delta-baseline-read-only.json'),
    read('rehearsal/p4-8/configure-auth-smtp-from-vercel.ps1'),
  ].join('\n')
  assert.doesNotMatch(content, /sb_secret_[A-Za-z0-9_-]+/u)
  assert.doesNotMatch(content, /postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/u)
  assert.doesNotMatch(content, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u)
  assert.doesNotMatch(content, /(?:SMTP_PASSWORD|FROMTIS_PASSWORD)\s*=\s*[^\s<]+/u)
})
