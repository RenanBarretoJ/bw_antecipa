import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const APP_HASH = '60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666'
const CUTOVER_HASH = '52e9b35f126ba3ad7c34609fb45d9173400c2656828a67558eba6821bbb5bb50'
const MIGRATION_HASH = 'cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318'
const DLZ_HASH = '886a8346426ecda2f473dc2d768aacd6d62b1cca47663eac3fff1aa38e51e749'

test('P4.6 permanece fail-closed sem SMTP Auth e rollback formal do banco', () => {
  const report = read('docs/homologacao/p4-6-final-production-go-gate.md')
  assert.match(report, /P4_6_FINAL_GO_GATE = FAIL/u)
  assert.match(report, /CUTOVER_PRODUCAO = NO_GO/u)
  assert.match(report, /SUPABASE_AUTH_SMTP_READY = PENDENTE_SECRET/u)
  assert.match(report, /AUTH_EMAIL_DELIVERY_TEST = NA/u)
  assert.match(report, /RESTORE_OWNER = MISSING/u)
  assert.match(report, /DB_ROLLBACK_READY = FAIL/u)
})

test('P4.6 preserva baseline e os quatro hashes canônicos', () => {
  const report = read('docs/homologacao/p4-6-final-production-go-gate.md')
  assert.match(report, /PRODUCTION_BASELINE = STABLE/u)
  assert.match(report, new RegExp(APP_HASH, 'u'))
  assert.match(report, new RegExp(CUTOVER_HASH, 'u'))
  assert.match(report, new RegExp(MIGRATION_HASH, 'u'))
  assert.match(report, new RegExp(DLZ_HASH, 'u'))
})

test('freeze plan contém exatamente os 20 arquivos materiais alterados', () => {
  const report = read('docs/homologacao/p4-6-final-production-go-gate.md')
  const manifest = JSON.parse(read('rehearsal/manifests/release-scopes.json'))
  const appFiles = new Set(manifest.app_release.entries.map(({ file }) => file))
  const cutoverFiles = new Set(manifest.cutover_bundle.entries.map(({ file }) => file))
  const status = childProcess.execFileSync('git', ['status', '--porcelain=v1', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const changed = [...new Set(status.split('\0').filter(Boolean).map((line) => {
    const file = line.slice(3)
    return file.includes(' -> ') ? file.split(' -> ').at(-1) : file
  }))]

  assert.equal(manifest.app_release.files, 724)
  assert.equal(manifest.cutover_bundle.files, 20)
  assert.equal(changed.filter((file) => appFiles.has(file)).length, 15)
  assert.equal(changed.filter((file) => cutoverFiles.has(file)).length, 5)
  assert.match(report, /15 da aplicação e 5 do cutover/u)
  assert.match(report, /RC_FREEZE_PLAN = READY/u)
  assert.match(report, /RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO/u)
})

test('artefatos P4.6 não contêm credenciais hardcoded', () => {
  const content = read('docs/homologacao/p4-6-final-production-go-gate.md')
  assert.doesNotMatch(content, /sb_secret_[A-Za-z0-9_-]+/u)
  assert.doesNotMatch(content, /postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/u)
  assert.doesNotMatch(content, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u)
  assert.doesNotMatch(content, /(?:SMTP_PASSWORD|FROMTIS_PASSWORD)\s*=\s*[^\s<]+/u)
})
