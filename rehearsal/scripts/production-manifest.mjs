import fs from 'node:fs'
import path from 'node:path'
import {
  REHEARSAL_ROOT,
  REPOSITORY_ROOT,
  fileSha256,
  sha256,
  stableJson,
  writeJson,
} from './lib.mjs'

export const PRODUCTION_MANIFEST_PATH = path.join(REHEARSAL_ROOT, 'manifests', 'production-migrations.json')
export const MIGRATIONS_DIRECTORY = path.join(REPOSITORY_ROOT, 'supabase', 'migrations')

export const BASELINE_FILES = Object.freeze([
  '003_storage_buckets_env.sql',
  '004_aceite_sacado_em.sql',
  '005_testemunhas.sql',
  '006_documentos_assinados.sql',
  '007_rename_aceite_sacado_em.sql',
  '008_document_update_request.sql',
  '009_habilitar_escrow_cedente.sql',
  '010_solicitacoes_alteracao_cedente.sql',
  '011_cedente_acessos.sql',
  '012_storage_policies_acesso_vinculado.sql',
  '013_nf_solicitar_ajuste.sql',
  '014_coobrigacao_notificacao.sql',
  '015_remessa_fromtis.sql',
  '016_termo_quitacao.sql',
])

export const PRE_UPGRADE_BRIDGES = Object.freeze([
  '20260827183411_bridge_consultor_cedentes_para_consultor_cedente.sql',
  '20260827184403_bridge_documentos_representante_legado.sql',
  '20260827185557_bridge_remover_policies_legadas_gestor_global.sql',
])

export const P2_PRODUCTION_CORRECTIONS = Object.freeze([
  '20260827203000_p2_runtime_compatibilidade_sacado_admin.sql',
  '20260827204000_p2_runtime_notificacoes_authenticated.sql',
  '20260827205000_p2_runtime_restaurar_trigger_profile_auth.sql',
])

export const POST_UPGRADE_DATA_PATCHES = Object.freeze([
  '20260827213304_p3_1_vincular_cedentes_dlz.sql',
])

export const BLOCKED_HOMOLOG_MIGRATIONS = Object.freeze([
  { file: '20260723182639_reset_operacional_fundo_homolog_rpc.sql', reason: 'RPC destrutiva exclusiva de homologacao' },
  { file: '20260728153646_reset_operacional_eventos_dominio.sql', reason: 'Correcao da RPC destrutiva de homologacao' },
  { file: '20260804103235_corrigir_reset_postergacoes_canhoto.sql', reason: 'Correcao da RPC destrutiva de homologacao' },
  { file: '20260811153000_corrigir_reset_dependencias_logisticas_duplicatas.sql', reason: 'Correcao da RPC destrutiva de homologacao' },
  { file: '20260823125731_corrigir_reset_dependencias_risco.sql', reason: 'Correcao da RPC destrutiva de homologacao' },
])

function migrationEntry(file) {
  return { file, sha256: fileSha256(path.join(MIGRATIONS_DIRECTORY, file)) }
}

function manifestPayload(manifest) {
  const payload = { ...manifest }
  delete payload.manifest_hash
  return payload
}

function assertExactArray(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} diverge da ordem canonica.`)
  }
}

export function sqlContentMatchesSha256(content, expectedHash) {
  const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
  if (sha256(raw) === expectedHash) return true

  const lf = raw.toString('utf8').replace(/\r\n?/gu, '\n')
  if (sha256(Buffer.from(lf, 'utf8')) === expectedHash) return true

  const crlf = lf.replace(/\n/gu, '\r\n')
  return sha256(Buffer.from(crlf, 'utf8')) === expectedHash
}

export function buildProductionManifest() {
  const files = fs.readdirSync(MIGRATIONS_DIRECTORY)
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, 'en'))
  const excluded = new Set([
    ...BASELINE_FILES,
    ...PRE_UPGRADE_BRIDGES,
    ...POST_UPGRADE_DATA_PATCHES,
    ...BLOCKED_HOMOLOG_MIGRATIONS.map(({ file }) => file),
  ])
  const upgradeFiles = files.filter((file) => !excluded.has(file))
  const payload = {
    schema_version: 1,
    release: 'P3_RELEASE_CANDIDATE_PRODUCAO',
    baseline_existing: BASELINE_FILES.map(migrationEntry),
    pre_upgrade_bridges: PRE_UPGRADE_BRIDGES.map(migrationEntry),
    upgrade_order: upgradeFiles.map(migrationEntry),
    post_upgrade_data_patches: POST_UPGRADE_DATA_PATCHES.map(migrationEntry),
    p2_production_corrections: [...P2_PRODUCTION_CORRECTIONS],
    blocked_homolog_only: BLOCKED_HOMOLOG_MIGRATIONS.map(({ file, reason }) => ({ file, reason, sha256: migrationEntry(file).sha256 })),
  }
  return { ...payload, manifest_hash: sha256(stableJson(payload)) }
}

export function writeProductionManifest() {
  const manifest = buildProductionManifest()
  fs.mkdirSync(path.dirname(PRODUCTION_MANIFEST_PATH), { recursive: true })
  writeJson(PRODUCTION_MANIFEST_PATH, manifest)
  return manifest
}

export function validateProductionManifest(manifest = null) {
  const parsed = manifest ?? JSON.parse(fs.readFileSync(PRODUCTION_MANIFEST_PATH, 'utf8'))
  if (parsed.schema_version !== 1 || parsed.release !== 'P3_RELEASE_CANDIDATE_PRODUCAO') {
    throw new Error('Cabecalho do manifesto de producao invalido.')
  }
  const expectedHash = sha256(stableJson(manifestPayload(parsed)))
  if (parsed.manifest_hash !== expectedHash) throw new Error('Hash do manifesto de producao diverge do conteudo.')

  const baseline = parsed.baseline_existing?.map(({ file }) => file) ?? []
  const bridges = parsed.pre_upgrade_bridges?.map(({ file }) => file) ?? []
  const upgrades = parsed.upgrade_order?.map(({ file }) => file) ?? []
  const blocked = parsed.blocked_homolog_only?.map(({ file }) => file) ?? []
  const dataPatches = parsed.post_upgrade_data_patches?.map(({ file }) => file) ?? []
  assertExactArray(baseline, [...BASELINE_FILES], 'Baseline')
  assertExactArray(bridges, [...PRE_UPGRADE_BRIDGES], 'Bridges')
  assertExactArray(blocked, BLOCKED_HOMOLOG_MIGRATIONS.map(({ file }) => file), 'Exclusoes de homologacao')
  assertExactArray(parsed.p2_production_corrections, [...P2_PRODUCTION_CORRECTIONS], 'Correcoes P2')
  assertExactArray(dataPatches, [...POST_UPGRADE_DATA_PATCHES], 'Patches de dados pos-upgrade')

  const sortedUpgrades = [...upgrades].sort((left, right) => left.localeCompare(right, 'en'))
  assertExactArray(upgrades, sortedUpgrades, 'Migrations de upgrade')
  for (const correction of P2_PRODUCTION_CORRECTIONS) {
    if (!upgrades.includes(correction)) throw new Error(`Correcao P2 ausente do manifesto: ${correction}.`)
  }
  for (const file of blocked) {
    if (upgrades.includes(file) || bridges.includes(file) || baseline.includes(file)) {
      throw new Error(`Migration bloqueada entrou na cadeia promovivel: ${file}.`)
    }
  }

  const accounted = [...baseline, ...bridges, ...upgrades, ...dataPatches, ...blocked]
  if (new Set(accounted).size !== accounted.length) throw new Error('Manifesto possui migration duplicada.')
  const repositoryFiles = fs.readdirSync(MIGRATIONS_DIRECTORY)
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, 'en'))
  assertExactArray([...accounted].sort((left, right) => left.localeCompare(right, 'en')), repositoryFiles, 'Cobertura do diretorio de migrations')

  for (const section of ['baseline_existing', 'pre_upgrade_bridges', 'upgrade_order', 'post_upgrade_data_patches', 'blocked_homolog_only']) {
    for (const entry of parsed[section] ?? []) {
      const content = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, entry.file))
      if (!sqlContentMatchesSha256(content, entry.sha256)) throw new Error(`Conteudo alterado apos certificacao: ${entry.file}.`)
    }
  }

  return {
    manifest_hash: parsed.manifest_hash,
    baseline_count: baseline.length,
    bridge_count: bridges.length,
    upgrade_count: upgrades.length,
    data_patch_count: dataPatches.length,
    blocked_count: blocked.length,
    manifest: parsed,
  }
}
