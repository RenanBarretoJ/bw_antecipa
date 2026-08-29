import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const reportPath = path.join(root, 'docs', 'homologacao', 'p4-1-production-infrastructure-readiness.md')
const report = readFileSync(reportPath, 'utf8')

const requiredFlags = [
  'P4_1_INFRA_PRODUCAO = FAIL',
  'VERCEL_PROJECT_IDENTIFIED = FAIL',
  'VERCEL_DEPLOYED_COMMIT_IDENTIFIED = PASS',
  'VERCEL_PROD_ENV_READY = NAO_VERIFICAVEL',
  'APP_URL_PROD_READY = FAIL',
  'SINQIA_TERRA_ENV_READY = NAO_VERIFICAVEL',
  'AUTH_SITE_URL_READY = NAO_VERIFICAVEL',
  'AUTH_REDIRECTS_READY = NAO_VERIFICAVEL',
  'AUTH_MFA_READY = FAIL',
  'SUPABASE_AUTH_SMTP_READY = NAO_VERIFICAVEL',
  'APP_SMTP_READY = NAO_VERIFICAVEL',
  'BACKUP_READY = NAO_VERIFICAVEL',
  'PITR_READY = NAO_VERIFICAVEL',
  'RESTORE_CAPABILITY_READY = FAIL',
  'RTO_EVIDENCE = NAO_COMPROVADO',
  'APP_ROLLBACK_READY = NAO_VERIFICAVEL',
  'DB_ROLLBACK_READY = FAIL',
  'RC_CONTENT_UNCHANGED = PASS',
  'RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO',
]

test('relatorio P4.1 contem todas as flags obrigatorias', () => {
  for (const flag of requiredFlags) assert.match(report, new RegExp(flag.replaceAll('.', '\\.')))
})

test('relatorio registra somente nomes das variaveis e nao material sensivel', () => {
  for (const name of [
    'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    'APP_BASE_URL', 'NEXT_PUBLIC_APP_ENV', 'FROMTIS_URL', 'FROMTIS_USERNAME', 'FROMTIS_PASSWORD',
    'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM', 'CRON_SECRET', 'PORTAL_FIDC_CREDENTIAL_KEYS_JSON',
  ]) assert.match(report, new RegExp(`\\b${name}\\b`))

  assert.doesNotMatch(report, /\bgh[opsu]_[A-Za-z0-9_]{20,}\b/u)
  assert.doesNotMatch(report, /\bsb_(?:secret|publishable)_[A-Za-z0-9_]{20,}\b/u)
  assert.doesNotMatch(report, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/u)
  assert.doesNotMatch(report, /postgres(?:ql)?:\/\/[^\s@]+@/iu)
  assert.doesNotMatch(report, /(?:FROMTIS_PASSWORD|SMTP_PASSWORD|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*[^\s`|]+/iu)
})

test('evidencia associa dominio, deployment e commit sem presumir envs', () => {
  assert.match(report, /5440379384/u)
  assert.match(report, /7a3087870cc8a80ab020676f1db33600804e5825/u)
  assert.match(report, /bw-antecipa\.better-with\.tech/u)
  assert.match(report, /NÃO VERIFICÁVEL/u)
})

test('relatorio preserva o escopo read-only e nao declara cutover pronto', () => {
  assert.match(report, /Produção permaneceu integralmente `READ-ONLY`/u)
  assert.doesNotMatch(report, /P4_1_INFRA_PRODUCAO = PASS/u)
  assert.doesNotMatch(report, /CUTOVER_PRODUCAO = GO/u)
})

