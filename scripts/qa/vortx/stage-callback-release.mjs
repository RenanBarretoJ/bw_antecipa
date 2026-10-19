// Explicit index assembly only. Preserves all unstaged native-stock work in this worktree.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
function git(args, input) {
  const r = spawnSync('git', args, { input, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  assert.equal(r.status, 0, 'GIT_INDEX_OPERATION_FAILED'); return r.stdout.trim()
}
assert.equal(git(['branch', '--show-current']), 'feature/vortx-real-data-preview')
assert.equal(git(['diff', '--cached', '--name-only']), '', 'PREEXISTING_INDEX_CHANGES')
const paths = [
  'src/app/admin/fundos/callback-vortx-actions.ts', 'src/app/admin/fundos/callback-vortx-actions.test.ts',
  'src/app/api/integracoes/vortx/relatorios/callback/route.ts', 'src/app/api/integracoes/vortx/relatorios/callback/route.test.ts',
  'src/components/admin/integration-draft-form.tsx', 'src/components/admin/vortx-callback-section.tsx',
  'src/lib/integracoes/vortx/callback-admin.ts', 'src/lib/integracoes/vortx/callback-admin.server.ts',
  'src/lib/integracoes/vortx/relatorios-callback.ts', 'src/lib/integracoes/vortx/relatorios-callback-handler.server.ts',
  'src/lib/integracoes/vortx/relatorios-callback-repository.server.ts', 'src/lib/integracoes/vortx/relatorios-callback-database.ts', 'src/lib/integracoes/vortx/relatorios-callback.test.ts',
  'supabase/migrations/20261019201346_vortx_report_callback_inbox.sql', 'supabase/migrations/20261019203424_vortx_callback_admin_ui.sql',
  'scripts/qa/vortx/callback-admin-checks.mjs', 'scripts/qa/vortx/callback-browser.mjs', 'scripts/qa/vortx/callback-sql-rehearsal.mjs',
  'scripts/qa/vortx/stage-callback-release.mjs', 'scripts/qa/vortx/prepare-callback-migrations.mjs',
]
git(['add', '--', ...paths])
// Only the callback RPC intersection enters this release. Native-stock fields/types stay unstaged.
const original = git(['show', 'HEAD:src/types/database.ts']) + '\n'
const needle = "import('@/lib/integracoes/vortx/relatorios-database').VortxReportFunctions & {"
assert.equal(original.split(needle).length, 2)
const content = original.replace(needle, "import('@/lib/integracoes/vortx/relatorios-database').VortxReportFunctions & import('@/lib/integracoes/vortx/relatorios-callback-database').VortxCallbackFunctions & {")
const blob = git(['hash-object', '-w', '--stdin'], content)
git(['update-index', '--add', '--cacheinfo', `100644,${blob},src/types/database.ts`])
const staged = git(['diff', '--cached', '--name-only']).split('\n')
assert.deepEqual(staged.sort(), [...paths, 'src/types/database.ts'].sort())
assert(!git(['show', ':src/types/database.ts']).includes('VortxStockFunctions'))
git(['diff', '--cached', '--check'])
console.log(JSON.stringify({ branch: git(['branch', '--show-current']), files: staged, nativeStockExcluded: true }))
