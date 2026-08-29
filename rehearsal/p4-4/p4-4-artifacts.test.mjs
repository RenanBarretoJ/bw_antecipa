import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const APP_HASH = '60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666'
const CUTOVER_HASH = '52e9b35f126ba3ad7c34609fb45d9173400c2656828a67558eba6821bbb5bb50'
const CURRENT_CUTOVER_HASH = 'dc7ef0d88a4dbde49107b62a30a906dcc675de6ae6ed3e9f274f6b2529289a90'

test('relatorio P4.4 usa os hashes canonicos e decide NO_GO de forma fail-closed', () => {
  const report = read('docs/homologacao/p4-4-infra-rc-final.md')
  assert.match(report, new RegExp(`APP_RELEASE_HASH = ${APP_HASH}`, 'u'))
  assert.match(report, new RegExp(`CUTOVER_BUNDLE_HASH = ${CUTOVER_HASH}`, 'u'))
  assert.match(report, /P4_4_INFRA_E_RC_FINAL = FAIL/u)
  assert.match(report, /CUTOVER_PRODUCAO = NO_GO/u)
  assert.match(report, /RC_MATERIAL_STATE = UNCHANGED/u)
  assert.match(report, /PRODUCTION_BASELINE = STABLE/u)
  assert.match(report, /DB_ROLLBACK_READY = FAIL/u)
})

test('checklist nao aprova evidencias administrativas ausentes', () => {
  const checklist = read('docs/homologacao/p4-3-checklist-manual-infra-producao.md')
  assert.match(checklist, /Site URL Auth[\s\S]*FAIL — PENDENTE MANUAL/u)
  assert.match(checklist, /MFA\/TOTP do projeto[\s\S]*FAIL — PENDENTE MANUAL/u)
  assert.match(checklist, /PITR\/recovery window[\s\S]*FAIL/u)
  assert.match(checklist, /Restore\/RTO[\s\S]*FAIL/u)
  assert.match(checklist, /nao foi executado no P4\.4|não foi executado no P4\.4/u)
})

test('manifesto preserva APP_RELEASE e versiona o bundle posterior ao P4.4', () => {
  const manifest = JSON.parse(read('rehearsal/manifests/release-scopes.json'))
  assert.equal(manifest.app_release.hash, APP_HASH)
  assert.equal(manifest.cutover_bundle.hash, CURRENT_CUTOVER_HASH)
  assert.equal(manifest.app_release.files, 724)
  assert.equal(manifest.cutover_bundle.files, 20)
})
