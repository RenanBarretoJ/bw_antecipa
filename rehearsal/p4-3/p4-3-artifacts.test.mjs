import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const report = readFileSync(path.join(root, 'docs', 'homologacao', 'p4-3-infra-producao-reavaliacao-go.md'), 'utf8')
const checklist = readFileSync(path.join(root, 'docs', 'homologacao', 'p4-3-checklist-manual-infra-producao.md'), 'utf8')

const flags = [
  'P4_3_INFRA_FINAL = FAIL',
  'VERCEL_PROJECT_IDENTIFIED = FAIL',
  'VERCEL_PROD_ENV_READY = FAIL',
  'APP_URL_PROD_READY = FAIL',
  'SINQIA_TERRA_ENV_READY = FAIL',
  'AUTH_SITE_URL_READY = FAIL',
  'AUTH_REDIRECTS_READY = FAIL',
  'AUTH_MFA_READY = FAIL',
  'SUPABASE_AUTH_SMTP_READY = FAIL',
  'APP_SMTP_READY = FAIL',
  'BACKUP_READY = FAIL',
  'PITR_READY = FAIL',
  'RESTORE_CAPABILITY_READY = FAIL',
  'RTO_EVIDENCE = NAO_COMPROVADO',
  'APP_ROLLBACK_READY = FAIL',
  'DB_ROLLBACK_READY = FAIL',
  'DLZ_CUTOVER_CONFIG_READY = PASS',
  'RC_CONTENT_UNCHANGED = FAIL',
  'RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO',
  'CUTOVER_PRODUCAO = NO_GO',
]

test('relatorio P4.3 contem todos os gates e mantem NO_GO', () => {
  for (const flag of flags) assert.match(report, new RegExp(flag.replaceAll('.', '\\.')))
  assert.doesNotMatch(report, /P4_3_INFRA_FINAL = PASS(?:\s|$)/u)
  assert.doesNotMatch(report, /CUTOVER_PRODUCAO = GO(?:\s|$)/u)
})

test('relatorio registra a evidencia objetiva e o delta do RC', () => {
  assert.match(report, /5440379384/u)
  assert.match(report, /7a3087870cc8a80ab020676f1db33600804e5825/u)
  assert.match(report, /e30c04e68c91a58663ebde360a280629042ad4e7c7aeb3c2254c95f1dea48696/u)
  assert.match(report, /cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318/u)
})

test('checklist possui campos de quatro olhos para cada gate externo', () => {
  for (const heading of ['Resultado observado', 'Revisor 1', 'Revisor 2', 'Timestamp']) {
    assert.match(checklist, new RegExp(heading, 'u'))
  }
  for (const item of ['Projeto Vercel', 'MFA/TOTP do projeto', 'Backup mais recente', 'Restore/RTO', 'Rollback Vercel', 'Rollback de banco']) {
    assert.match(checklist, new RegExp(item, 'u'))
  }
})

test('artefatos P4.3 nao contem formatos comuns de secrets', () => {
  const combined = `${report}\n${checklist}`
  assert.doesNotMatch(combined, /\bgh[opsu]_[A-Za-z0-9_]{20,}\b/u)
  assert.doesNotMatch(combined, /\bsb_(?:secret|publishable)_[A-Za-z0-9_]{20,}\b/u)
  assert.doesNotMatch(combined, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/u)
  assert.doesNotMatch(combined, /postgres(?:ql)?:\/\/[^\s@]+@/iu)
  assert.doesNotMatch(combined, /(?:FROMTIS_PASSWORD|SMTP_PASSWORD|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*[^\s`|]+/iu)
})

test('relatorio confirma que producao permaneceu read-only', () => {
  assert.match(report, /Produção: integralmente `READ-ONLY`/u)
  assert.match(report, /não foram executados/iu)
})
