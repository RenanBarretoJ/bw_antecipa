import fs from 'node:fs'
import path from 'node:path'
import {
  PRODUCTION_PROJECT_REF,
  REHEARSAL_ROOT,
  REPOSITORY_ROOT,
  extractProjectRef,
  sha256,
  stableJson,
} from './lib.mjs'
import { sqlContentMatchesSha256, validateProductionManifest } from './production-manifest.mjs'

export const DLZ_ID = '7a114257-7816-468e-adf4-d796b93364df'
export const IMPULSE_ID = 'cb372689-65c8-43af-8a20-7438002a3b91'
export const PRODUCTION_CONFIRMATION = 'DLZ_HEALTH_PRODUCTION_CUTOVER'
export const CONFIG_MANIFEST_PATH = path.join(REHEARSAL_ROOT, 'manifests', 'dlz-production-config.json')
export const EXPECTED_CONFIG_MANIFEST_HASH = '5833541e93b9f9213c21b300771f53b47de3cf06242b7afd5fb51b5c06202d6c'

function payloadOf(manifest) {
  const payload = { ...manifest }
  delete payload.manifest_hash
  return payload
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function exactKeys(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} deve ser objeto.`)
  assert(Object.keys(value).sort().join('|') === [...keys].sort().join('|'), `${label} possui campos inesperados.`)
}

export function loadDlzConfigManifest() {
  const manifest = JSON.parse(fs.readFileSync(CONFIG_MANIFEST_PATH, 'utf8'))
  const calculatedHash = sha256(stableJson(payloadOf(manifest)))
  assert(manifest.manifest_hash === calculatedHash, 'Hash interno do manifesto DLZ diverge do conteudo.')
  assert(calculatedHash === EXPECTED_CONFIG_MANIFEST_HASH, 'Manifesto DLZ nao corresponde ao artefato certificado.')
  assert(manifest.schema_version === 1 && manifest.release === 'P4_2_DLZ_HEALTH_PRODUCTION_CONFIG', 'Cabecalho do manifesto DLZ invalido.')
  assert(manifest.environment === 'production', 'Manifesto DLZ nao declara production.')
  assert(manifest.project_ref === PRODUCTION_PROJECT_REF, 'Project ref do manifesto DLZ invalido.')
  assert(manifest.fundo_id === DLZ_ID && manifest.impulse_fundo_id === IMPULSE_ID, 'Fundos certificados divergentes no manifesto DLZ.')
  assert(manifest.policy.acceptance_required === true, 'Aceite do Sacado deve permanecer obrigatorio.')
  assert(manifest.policy.risk_gate === false && manifest.policy.logistics_exposure_control === false, 'Risco financeiro deve permanecer nao aplicavel.')
  assert(Array.isArray(manifest.policy.requirements) && manifest.policy.requirements.length === 0, 'Requisitos nao certificados foram adicionados.')
  assert(manifest.templates.mode === 'COMPAT_LEGADO', 'Modo de templates nao certificado.')
  assert(/^\d+$/.test(manifest.cnab.originator_code), 'Codigo originador deve ser texto numerico.')
  assert(manifest.cnab.originator_code === '00000000000000500497', 'Codigo originador DLZ divergente.')
  assert(manifest.integration.runtime_mode === 'legacy_env_sinqia_terra', 'Runtime mode da integracao divergente.')
  assert(manifest.integration.capability === 'CESSAO_ENVIO', 'Capability da integracao divergente.')
  assert(manifest.integration.credential_required === false && manifest.integration.database_secret === false, 'Manifesto nao pode exigir ou armazenar credencial.')
  exactKeys(manifest.integration, ['provider', 'provider_key', 'system_name', 'name', 'adapter_key', 'runtime_mode', 'capability', 'environment', 'client_identifier', 'endpoint_placeholder', 'credential_reference', 'credential_required', 'database_secret'], 'Integracao')
  for (const reference of manifest.templates.references) {
    assert(fs.existsSync(path.join(REPOSITORY_ROOT, reference)), `Template legado homologado ausente: ${reference}.`)
  }
  const production = validateProductionManifest()
  assert(production.manifest_hash === manifest.production_migrations_manifest_hash, 'Hash do manifesto de migrations diverge do P4.2.')
  const preflightPath = path.join(REPOSITORY_ROOT, 'docs', 'homologacao', 'sql', 'p4-preflight-producao-read-only.sql')
  assert(sqlContentMatchesSha256(fs.readFileSync(preflightPath), manifest.preflight_sql_sha256), 'Preflight SQL diverge do hash certificado.')
  return { manifest, manifestHash: calculatedHash, production }
}

export function assertProductionApplyGuards({ env, args, manifestHash, productionManifestHash, databaseUrl }) {
  assert((env.NEXT_PUBLIC_APP_ENV || env.APP_ENV) === 'production', 'Ambiente runtime deve ser explicitamente production.')
  assert(args.target === 'production', 'Apply remoto exige --target production.')
  assert(args.fundoId === DLZ_ID, `Apply exige --fundo-id ${DLZ_ID}.`)
  assert(databaseUrl, 'DLZ_PRODUCTION_DB_URL nao informada.')
  assert(extractProjectRef(databaseUrl) === PRODUCTION_PROJECT_REF, 'Conexao nao identifica o project ref de producao certificado.')
  assert(args.projectRef === PRODUCTION_PROJECT_REF, `Apply exige --project-ref ${PRODUCTION_PROJECT_REF}.`)
  assert(args.manifestHash === manifestHash, 'Hash do manifesto DLZ nao confirmado na CLI.')
  assert(args.releaseManifestHash === productionManifestHash, 'Hash do manifesto de migrations nao confirmado na CLI.')
  assert(args.preflightHash && args.preflightHash === env.DLZ_PRODUCTION_PREFLIGHT_HASH, 'Hash do preflight aprovado nao confere.')
  assert(env.DLZ_PRODUCTION_PREFLIGHT_APPROVED === 'true', 'Preflight de producao nao foi explicitamente aprovado.')
  assert(env.ALLOW_DLZ_PRODUCTION_CONFIG === 'true', 'Janela de configuracao DLZ nao foi explicitamente liberada.')
  assert(args.confirm === PRODUCTION_CONFIRMATION, 'Frase de confirmacao de cutover ausente ou invalida.')
  return true
}

export function parseArgs(argv) {
  const modes = ['plan', 'apply', 'verify'].filter((mode) => argv.includes(`--${mode}`))
  assert(modes.length === 1, 'Informe exatamente um modo: --plan, --apply ou --verify.')
  const value = (name) => argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3)
  const target = value('target')
  assert(['local', 'production'].includes(target), 'Informe --target=local ou --target=production.')
  return {
    mode: modes[0], target,
    fundoId: value('fundo-id'), projectRef: value('project-ref'), manifestHash: value('manifest-hash'),
    releaseManifestHash: value('release-manifest-hash'), preflightHash: value('preflight-hash'),
    confirm: value('confirm'), correlationId: value('correlation-id'),
  }
}

export function equivalent(actual, expected, fields) {
  return fields.every((field) => stableJson(actual?.[field] ?? null) === stableJson(expected?.[field] ?? null))
}
