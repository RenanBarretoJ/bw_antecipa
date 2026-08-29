import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const APP_HASH = '60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666'
const CUTOVER_HASH = '52e9b35f126ba3ad7c34609fb45d9173400c2656828a67558eba6821bbb5bb50'

test('relatorio P4.5 mantem decisao fail-closed para SMTP Auth e rollback do banco', () => {
  const report = read('docs/homologacao/p4-5-remediacao-infra-producao.md')
  assert.match(report, /P4_5_INFRA_PRODUCAO = FAIL/u)
  assert.match(report, /CUTOVER_PRODUCAO = NO_GO/u)
  assert.match(report, /SUPABASE_AUTH_SMTP_READY = PENDENTE_SECRET/u)
  assert.match(report, /DB_ROLLBACK_READY = FAIL/u)
  assert.match(report, /RTO_EVIDENCE = NAO_COMPROVADO/u)
})

test('relatorio P4.5 registra baseline e hashes canonicos sem alterar o RC', () => {
  const report = read('docs/homologacao/p4-5-remediacao-infra-producao.md')
  assert.match(report, /PRODUCTION_BASELINE = STABLE/u)
  assert.match(report, new RegExp(`APP_RELEASE_HASH = ${APP_HASH}`, 'u'))
  assert.match(report, new RegExp(`CUTOVER_BUNDLE_HASH = ${CUTOVER_HASH}`, 'u'))
  assert.match(report, /RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO/u)
})

test('artefatos P4.5 nao possuem valores secretos hardcoded', () => {
  const files = [
    'docs/homologacao/p4-5-remediacao-infra-producao.md',
    'rehearsal/p4-5/vercel-production-check.mjs',
    'rehearsal/p4-5/supabase-auth-config.ps1',
  ]
  const combined = files.map(read).join('\n')

  assert.doesNotMatch(combined, /sb_secret_[A-Za-z0-9_-]+/u)
  assert.doesNotMatch(combined, /postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/u)
  assert.doesNotMatch(combined, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u)
  assert.doesNotMatch(combined, /(?:SMTP_PASSWORD|FROMTIS_PASSWORD)\s*=\s*[^\s<]+/u)
})
