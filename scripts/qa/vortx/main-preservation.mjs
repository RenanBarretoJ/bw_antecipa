import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const manifest = JSON.parse(readFileSync(new URL('./main-integration-manifest.json', import.meta.url), 'utf8'))
const git = args => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  assert.equal(result.status, 0, `GIT_CHECK_FAILED:${args[0]}`)
  return result.stdout
}
const hash = text => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex')
const lines = text => text.trim().split('\n').filter(Boolean)

assert.equal(manifest.baseBranch, 'main', 'HOMOLOG_IS_NOT_A_DEVELOPMENT_BASE')
const publicationBase = manifest.publicationBaseCommit ?? manifest.baseCommit
assert.equal(git(['rev-parse', 'refs/remotes/origin/main']).trim(), publicationBase, 'REMOTE_MAIN_ADVANCED_RECONCILE_BEFORE_PUBLICATION')
git(['merge-base', '--is-ancestor', publicationBase, 'HEAD'])
git(['merge-base', '--is-ancestor', manifest.baseCommit, 'HEAD'])
const first = lines(git(['rev-list', '--first-parent', '--reverse', `${manifest.baseCommit}..HEAD`]))[0]
assert(first, 'MAIN_INTEGRATION_COMMITS_MISSING')
assert.equal(git(['rev-parse', `${first}^`]).trim(), manifest.baseCommit, 'BRANCH_MUST_START_AT_PINNED_MAIN')
for (const file of manifest.protectedFiles) {
  assert.equal(hash(readFileSync(resolve(root, file.path), 'utf8')), file.sha256, `MAIN_REGRESSION:${file.path}`)
}
const changedHistoricalMigrations = lines(git(['diff', '--name-only', '--diff-filter=DM', manifest.baseCommit, '--', 'supabase/migrations']))
assert.deepEqual(changedHistoricalMigrations, [], 'HISTORICAL_MAIN_MIGRATIONS_CHANGED')
for (const file of manifest.importedMigrations) {
  assert.equal(hash(readFileSync(resolve(root, file.path), 'utf8')), file.sha256, `IMPORTED_MIGRATION_BYTES_CHANGED:${file.path}`)
}
assert.equal(hash(readFileSync(resolve(root, manifest.nativeSnapshot.path), 'utf8')), manifest.nativeSnapshot.sha256, 'NATIVE_SNAPSHOT_HASH_DRIFT')
const allowed = new Set(lines(git(['diff', '--name-only', manifest.sourceBaseCommit, manifest.sourceCommit])))
for (const file of [
  'docs/development/engineering-standards.md',
  'src/lib/documentos/abrir-documento-client.ts', 'src/lib/documentos/abrir-documento-client.test.ts',
  'src/lib/integracoes/vortx/preview-branch.ts', 'src/lib/integracoes/vortx/preview-branch.test.ts',
  'scripts/qa/vortx/main-native-fixture.test.mjs',
  'scripts/qa/vortx/main-native-snapshot.test.mjs', manifest.nativeSnapshot.path,
  'scripts/qa/vortx/main-native-images.test.mjs',
  // Explicitly authorized DANFE layout hotfix on this same integration branch.
  // The protected main files, migration hashes and ancestry checks above remain exact.
  'src/lib/pdf-nf-parser.ts', 'src/lib/danfe/access-key.ts',
  'src/lib/danfe/fatura.ts', 'src/lib/danfe/inline-reference.test.ts',
  // Explicitly authorized production promotion. Preview diagnostic guards and
  // all protected main files/migration hashes remain checked above.
  'src/lib/integracoes/vortx/relatorios-runtime.ts',
  'src/lib/integracoes/vortx/relatorios-runtime.test.ts',
  'src/lib/integracoes/vortx/relatorios-production-boundaries.test.ts',
  'docs/integracoes/vortx-production-rollout.json',
]) allowed.add(file)
// Post-PR104 wallet work is explicit. The original ancestry, protected file hashes,
// imported migration hashes and historical migration checks above are not rebased.
for (const path of manifest.publicationFiles ?? []) allowed.add(path)
for (const path of lines(git(['diff', '--name-only', publicationBase]))) {
  assert(allowed.has(path) || /^scripts\/qa\/vortx\/main-[a-z-]+\.(?:mjs|json)$/.test(path), `OUT_OF_SCOPE_CHANGE:${path}`)
}
const renderer = readFileSync(resolve(root, 'src/lib/pdf/gerarContrato.ts'), 'utf8')
assert(renderer.includes("import { resolverExecutavelChromium } from './chromium-executable'"), 'MAIN_CHROMIUM_PREPARATION_IMPORT_REMOVED')
assert(renderer.includes('await resolverExecutavelChromium()'), 'MAIN_CHROMIUM_CONCURRENCY_FIX_REMOVED')
console.log(JSON.stringify({ result: 'PASS', base: manifest.baseCommit, publicationBase, source: manifest.sourceCommit,
  protectedFiles: manifest.protectedFiles.length, preservedMigrations: manifest.importedMigrations.length, historicalMigrationsChanged: 0 }))
