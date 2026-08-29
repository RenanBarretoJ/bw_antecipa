import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
export const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
export const RELEASE_SCOPES_MANIFEST = path.join(REPOSITORY_ROOT, 'rehearsal', 'manifests', 'release-scopes.json')
const PRODUCTION_MIGRATIONS_MANIFEST = path.join(REPOSITORY_ROOT, 'rehearsal', 'manifests', 'production-migrations.json')

const APP_RUNTIME_ROOTS = ['src', 'public']
const APP_BUILD_FILES = [
  'package.json',
  'package-lock.json',
  'next.config.ts',
  'tsconfig.json',
  'postcss.config.mjs',
]
const MIGRATION_GROUPS = [
  'baseline_existing',
  'pre_upgrade_bridges',
  'upgrade_order',
  'p2_production_corrections',
  'post_upgrade_data_patches',
]
const CUTOVER_FILES = [
  'rehearsal/manifests/production-migrations.json',
  'rehearsal/manifests/dlz-production-config.json',
  'rehearsal/manifests/dlz-production-config.sha256',
  'rehearsal/scripts/release-scopes.mjs',
  'rehearsal/scripts/lib.mjs',
  'rehearsal/scripts/production-manifest.mjs',
  'rehearsal/scripts/validate-production-manifest.mjs',
  'rehearsal/scripts/preflight-release-candidate.mjs',
  'rehearsal/scripts/release-candidate-inventory.mjs',
  'rehearsal/scripts/configure-dlz-production.mjs',
  'rehearsal/scripts/dlz-production-config.mjs',
  'rehearsal/scripts/cutover-dry-run.mjs',
  'rehearsal/scripts/p4-2-dlz-dry-run.mjs',
  'rehearsal/scripts/upgrade-local.mjs',
  'rehearsal/scripts/p5-2-forward-local.mjs',
  'docs/homologacao/sql/p4-preflight-producao-read-only.sql',
  'docs/homologacao/sql/p4-postflight-producao-read-only.sql',
  'docs/homologacao/p3-manifesto-migrations-producao.md',
  'docs/homologacao/p3-checklist-configuracoes-secrets.md',
  'docs/homologacao/p3-runbook-cutover-producao.md',
  'docs/homologacao/p3-runbook-rollback-producao.md',
  'docs/homologacao/p4-preflight-final-producao-dlz-health.md',
  'docs/homologacao/p5-2-neutralizacao-migrations-homolog.md',
]

function normalize(file) {
  return file.replaceAll('\\', '/')
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function isRuntimeFile(file) {
  const normalized = normalize(file)
  return !normalized.includes('/__tests__/')
    && !normalized.includes('/__fixtures__/')
    && !/\.(?:test|spec|stories)\.[^.]+$/u.test(normalized)
    && !/\.(?:architecture|runtime)\.test\.[^.]+$/u.test(normalized)
}

function gitIndexFiles(pathspecs = []) {
  const output = execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  })
  return output.split('\0').filter(Boolean).map(normalize)
}

function gitIndexContent(file) {
  return execFileSync('git', ['show', `:${file}`], {
    cwd: REPOSITORY_ROOT,
    maxBuffer: 50 * 1024 * 1024,
  })
}

function assertFilesExist(files, label) {
  const tracked = new Set(gitIndexFiles())
  const missing = files.filter((file) => !tracked.has(file))
  if (missing.length) throw new Error(`${label} contem arquivos ausentes: ${missing.join(', ')}`)
}

function productionMigrationFiles() {
  const manifest = JSON.parse(gitIndexContent(normalize(path.relative(REPOSITORY_ROOT, PRODUCTION_MIGRATIONS_MANIFEST))).toString('utf8'))
  const files = MIGRATION_GROUPS.flatMap((group) => {
    const entries = manifest[group]
    if (!Array.isArray(entries)) throw new Error(`Grupo de migrations ausente: ${group}`)
    return entries.map((entry) => typeof entry === 'string' ? entry : entry.file)
  })
  return [...new Set(files.map((file) => `supabase/migrations/${file}`))]
}

export function canonicalAppFiles() {
  const runtimeFiles = gitIndexFiles(APP_RUNTIME_ROOTS)
    .filter(isRuntimeFile)
  const files = [...new Set([...runtimeFiles, ...APP_BUILD_FILES, ...productionMigrationFiles()])].sort()
  assertFilesExist(files, 'APP_RELEASE')
  return files
}

export function canonicalCutoverFiles() {
  const files = [...new Set(CUTOVER_FILES)].sort()
  assertFilesExist(files, 'CUTOVER_BUNDLE')
  return files
}

function entries(files) {
  return files.map((file) => ({
    file,
    sha256: sha256(gitIndexContent(file)),
  }))
}

function scopeHash(kind, scopeEntries) {
  return sha256(stableJson({ schema_version: 1, kind, entries: scopeEntries }))
}

export function buildReleaseScopes() {
  const appEntries = entries(canonicalAppFiles())
  const cutoverEntries = entries(canonicalCutoverFiles())
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    policy: {
      app_release: 'Runtime, build e migrations promoviveis; exclui testes, relatorios e tooling de rehearsal.',
      cutover_bundle: 'Artefatos operacionais explicitamente usados na janela; exclui relatorios posteriores e testes.',
    },
    app_release: {
      files: appEntries.length,
      hash: scopeHash('APP_RELEASE', appEntries),
      entries: appEntries,
    },
    cutover_bundle: {
      files: cutoverEntries.length,
      hash: scopeHash('CUTOVER_BUNDLE', cutoverEntries),
      entries: cutoverEntries,
    },
  }
}

export function verifyReleaseScopes(manifest = JSON.parse(fs.readFileSync(RELEASE_SCOPES_MANIFEST, 'utf8'))) {
  if (manifest.schema_version !== 1) throw new Error('Versao do manifesto de escopos invalida.')
  const current = buildReleaseScopes()
  for (const scope of ['app_release', 'cutover_bundle']) {
    const expectedFiles = manifest[scope]?.entries?.map((entry) => entry.file)
    const currentFiles = current[scope].entries.map((entry) => entry.file)
    if (stableJson(expectedFiles) !== stableJson(currentFiles)) throw new Error(`Lista canonica divergiu em ${scope}.`)
    if (manifest[scope].hash !== current[scope].hash) throw new Error(`Hash divergiu em ${scope}.`)
    if (stableJson(manifest[scope].entries) !== stableJson(current[scope].entries)) throw new Error(`Conteudo divergiu em ${scope}.`)
  }
  return current
}

function run() {
  const mode = process.argv[2] || '--verify'
  if (mode === '--build') {
    const manifest = buildReleaseScopes()
    fs.writeFileSync(RELEASE_SCOPES_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    console.log(`APP_RELEASE_HASH = ${manifest.app_release.hash}`)
    console.log(`CUTOVER_BUNDLE_HASH = ${manifest.cutover_bundle.hash}`)
    console.log(`APP_RELEASE_FILES = ${manifest.app_release.files}`)
    console.log(`CUTOVER_BUNDLE_FILES = ${manifest.cutover_bundle.files}`)
    return
  }
  if (mode === '--verify') {
    const manifest = verifyReleaseScopes()
    console.log(`APP_RELEASE_HASH = ${manifest.app_release.hash}`)
    console.log(`CUTOVER_BUNDLE_HASH = ${manifest.cutover_bundle.hash}`)
    console.log('RELEASE_HASH_SCOPE = PASS')
    return
  }
  throw new Error('Modo invalido. Use --build ou --verify.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

