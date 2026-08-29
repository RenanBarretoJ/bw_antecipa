import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const APP_HASH = '60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666'
const CUTOVER_HASH = 'dc7ef0d88a4dbde49107b62a30a906dcc675de6ae6ed3e9f274f6b2529289a90'

test('P4.7 adota opcao B mas permanece NO_GO pelos gates pendentes', () => {
  const report = read('docs/homologacao/p4-7-final-readiness-backup-restore.md')
  assert.match(report, /P4_7_FINAL_READINESS = FAIL/u)
  assert.match(report, /CUTOVER_PRODUCAO = NO_GO/u)
  assert.match(report, /DB_RECOVERY_MODE = BACKUP_RESTORE_ALTERNATIVO/u)
  assert.match(report, /RESTORE_OWNER = MISSING/u)
  assert.match(report, /RTO_EVIDENCE = PENDENTE_ACEITE/u)
  assert.match(report, /SUPABASE_AUTH_SMTP_READY = PENDENTE_SECRET/u)
})

test('baseline materialmente alterada bloqueia o GO', () => {
  const report = read('docs/homologacao/p4-7-final-readiness-backup-restore.md')
  assert.match(report, /PRODUCTION_BASELINE = RISK/u)
  assert.match(report, /Operações \| 45 \| 46 \| \+1/u)
  assert.match(report, /Notas fiscais \| 903 \| 910 \| \+7/u)
  assert.match(report, /Storage metadata \| 1\.635 \| 1\.644 \| \+9/u)
})

test('runbooks formalizam backup pre-cutover e restore sem down migration', () => {
  const cutover = read('docs/homologacao/p3-runbook-cutover-producao.md')
  const rollback = read('docs/homologacao/p3-runbook-rollback-producao.md')
  assert.match(cutover, /BACKUP_RESTORE_ALTERNATIVO/u)
  assert.match(cutover, /bloquear e comprovar ausência de DML operacional/u)
  assert.match(rollback, /owner formalmente designado/u)
  assert.match(rollback, /sem down-migrations improvisadas/u)
  assert.match(rollback, /node rehearsal\/p4-7\/rollback-drill-local\.mjs/u)
})

test('APP_RELEASE permanece estavel e CUTOVER_BUNDLE e versionado', () => {
  const manifest = JSON.parse(read('rehearsal/manifests/release-scopes.json'))
  assert.equal(manifest.app_release.hash, APP_HASH)
  assert.equal(manifest.cutover_bundle.hash, CUTOVER_HASH)
  assert.equal(manifest.app_release.files, 724)
  assert.equal(manifest.cutover_bundle.files, 20)
})

test('relatorio P4.7 nao contem credenciais hardcoded', () => {
  const report = read('docs/homologacao/p4-7-final-readiness-backup-restore.md')
  assert.doesNotMatch(report, /sb_secret_[A-Za-z0-9_-]+/u)
  assert.doesNotMatch(report, /postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/u)
  assert.doesNotMatch(report, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u)
  assert.doesNotMatch(report, /(?:SMTP_PASSWORD|FROMTIS_PASSWORD)\s*=\s*[^\s<]+/u)
})
