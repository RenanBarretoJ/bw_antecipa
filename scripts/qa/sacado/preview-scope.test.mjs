import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const config = readFileSync('supabase/config.toml', 'utf8')
const manifest = JSON.parse(readFileSync('scripts/qa/sacado/preview-manifest.json', 'utf8'))
function sections(text) {
  const result = new Map()
  for (const part of text.replaceAll('\r\n', '\n').split(/^\[/m).slice(1)) {
    const end = part.indexOf(']')
    result.set(part.slice(0, end), part.slice(end + 1).replace(/#.*$/gm, '').trim())
  }
  return result
}
test('only the exact SACADO remote configuration is added', () => {
  const previous = spawnSync('git', ['show', `${manifest.baseSha}:supabase/config.toml`], { encoding: 'utf8', windowsHide: true })
  assert.equal(previous.status, 0)
  const original = sections(previous.stdout)
  const current = sections(config)
  for (const [name, value] of original) assert.equal(current.get(name), value, `OTHER_CONFIG_CHANGED:${name}`)
  assert.deepEqual([...current.keys()].filter(name => !original.has(name)), [
    'remotes."hotfix/sacado-multi-cnpj"',
    'remotes."hotfix/sacado-multi-cnpj".db.migrations',
    'remotes."hotfix/sacado-multi-cnpj".db.seed',
    'remotes."hotfix/sacado-multi-cnpj".auth',
  ])
  assert.equal(current.get('remotes."hotfix/sacado-multi-cnpj"'), 'project_id = "yynlrtonrqxoatmuclrt"')
  for (const name of ['db.migrations', 'db.seed']) {
    assert.match(current.get(name), /^enabled = true$/m)
    assert.equal(current.get(`remotes."hotfix/sacado-multi-cnpj".${name}`), 'enabled = false')
  }
  assert.match(current.get('remotes."hotfix/sacado-multi-cnpj".auth'), /^site_url = "https:\/\/bw-antecipa-git-hotfix-sacado-multi-cnpj-renanbarretoj.vercel.app"$/m)
})
test('manual preview target is pinned and no migration is implicitly authorized', () => {
  assert.equal(manifest.projectRef, 'yynlrtonrqxoatmuclrt')
  assert.equal(manifest.branchId, 'c31a3f44-0c5a-413d-8a39-b5d2eeda010e')
  assert.equal(manifest.mode, 'MANUAL_EXPLICIT_LIST')
  assert.equal(manifest.gitBranch, 'hotfix/sacado-multi-cnpj')
  assert.deepEqual(manifest.excludedVersions, ['20260929193129'])
  assert.equal(manifest.historicalDivergence, 'KNOWN_AND_PRESERVED')
  assert.deepEqual(manifest.migrations, [])
})
