import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DLZ_ID, EXPECTED_CONFIG_MANIFEST_HASH, PRODUCTION_CONFIRMATION,
  assertProductionApplyGuards, loadDlzConfigManifest, parseArgs,
} from './dlz-production-config.mjs'

test('manifesto DLZ e deterministico e nao contem credenciais', () => {
  const { manifest, manifestHash } = loadDlzConfigManifest()
  assert.equal(manifestHash, EXPECTED_CONFIG_MANIFEST_HASH)
  assert.equal(manifest.integration.database_secret, false)
  assert.equal(manifest.integration.credential_required, false)
  const serialized = JSON.stringify(manifest).toLowerCase()
  for (const forbidden of ['fromtis_password', 'fromtis_username', 'service_role_key', 'smtp_password', 'postgresql://']) {
    assert.equal(serialized.includes(forbidden), false, `conteudo proibido: ${forbidden}`)
  }
})

test('CLI exige exatamente um modo e alvo explicito', () => {
  assert.throws(() => parseArgs(['--target=local']), /exatamente um modo/u)
  assert.throws(() => parseArgs(['--plan', '--apply', '--target=local']), /exatamente um modo/u)
  assert.throws(() => parseArgs(['--plan']), /target/u)
  assert.equal(parseArgs(['--verify', '--target=local']).mode, 'verify')
})

function validGuardFixture() {
  const { manifestHash, production } = loadDlzConfigManifest()
  const preflightHash = 'approved-preflight-evidence'
  return {
    env: {
      NEXT_PUBLIC_APP_ENV: 'production', ALLOW_DLZ_PRODUCTION_CONFIG: 'true',
      DLZ_PRODUCTION_PREFLIGHT_APPROVED: 'true', DLZ_PRODUCTION_PREFLIGHT_HASH: preflightHash,
    },
    args: {
      target: 'production', fundoId: DLZ_ID, projectRef: 'wwsndnuvnjuabpbjwlck', manifestHash,
      releaseManifestHash: production.manifest_hash, preflightHash, confirm: PRODUCTION_CONFIRMATION,
    },
    manifestHash, productionManifestHash: production.manifest_hash,
    databaseUrl: 'postgresql://postgres.wwsndnuvnjuabpbjwlck:masked@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
  }
}

test('guardas de producao aceitam somente o conjunto completo', () => {
  assert.equal(assertProductionApplyGuards(validGuardFixture()), true)
})

for (const scenario of [
  ['runtime', (f) => { f.env.NEXT_PUBLIC_APP_ENV = 'homolog' }],
  ['fundo', (f) => { f.args.fundoId = 'cb372689-65c8-43af-8a20-7438002a3b91' }],
  ['project ref', (f) => { f.args.projectRef = 'fhgkmggthxikfpogrvaa' }],
  ['host/ref', (f) => { f.databaseUrl = 'postgresql://postgres.fhgkmggthxikfpogrvaa:masked@aws-0-us-east-1.pooler.supabase.com:5432/postgres' }],
  ['manifesto DLZ', (f) => { f.args.manifestHash = '0'.repeat(64) }],
  ['manifesto migrations', (f) => { f.args.releaseManifestHash = '0'.repeat(64) }],
  ['preflight', (f) => { f.env.DLZ_PRODUCTION_PREFLIGHT_APPROVED = 'false' }],
  ['janela', (f) => { f.env.ALLOW_DLZ_PRODUCTION_CONFIG = 'false' }],
  ['confirmacao', (f) => { f.args.confirm = 'INVALIDO' }],
]) {
  test(`guard fail-closed: ${scenario[0]}`, () => {
    const fixture = validGuardFixture()
    scenario[1](fixture)
    assert.throws(() => assertProductionApplyGuards(fixture))
  })
}

test('executor nao usa upsert silencioso nem contem endpoint real', () => {
  const source = fs.readFileSync(new URL('./configure-dlz-production.mjs', import.meta.url), 'utf8')
  assert.equal(/on\s+conflict/iu.test(source), false)
  assert.equal(source.includes('supabase.co'), false)
  assert.equal(source.includes('FROMTIS_PASSWORD'), false)
})

test('runbook e postflight preservam gates de cutover', () => {
  const runbook = fs.readFileSync(new URL('../../docs/homologacao/p3-runbook-cutover-producao.md', import.meta.url), 'utf8')
  const postflight = fs.readFileSync(new URL('../../docs/homologacao/sql/p4-postflight-producao-read-only.sql', import.meta.url), 'utf8')
  const report = fs.readFileSync(new URL('../../docs/homologacao/p4-2-configurador-seguro-producao-dlz-health.md', import.meta.url), 'utf8')
  assert.match(runbook, /--confirm=DLZ_HEALTH_PRODUCTION_CUTOVER/u)
  assert.match(runbook, /P4_1_INFRA_PRODUCAO = PASS/u)
  assert.match(postflight, /DLZ_READINESS/u)
  assert.match(report, /DLZ_CUTOVER_CONFIG_READY = PASS/u)
  assert.match(report, /CUTOVER_PRODUCAO = NO_GO/u)
})
