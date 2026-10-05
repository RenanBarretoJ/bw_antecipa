import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const config = readFileSync('supabase/config.toml', 'utf8')
const manifest = JSON.parse(readFileSync('scripts/qa/sacado/preview-manifest.json', 'utf8'))
const nfseRemote = 'remotes."hotfix/nfse-submit-frozen-facts"'
const nfseSections = new Map([
  [nfseRemote, 'project_id = "ettpaprrmpjsfkcystob"'],
  [`${nfseRemote}.db.migrations`, 'enabled = false'],
  [`${nfseRemote}.db.seed`, 'enabled = false'],
])
function sections(text) {
  const result = new Map()
  for (const part of text.replaceAll('\r\n', '\n').split(/^\[/m).slice(1)) {
    const end = part.indexOf(']')
    assert(!result.has(part.slice(0, end)), 'DUPLICATE_CONFIG_SECTION')
    result.set(part.slice(0, end), part.slice(end + 1).replace(/#.*$/gm, '').trim())
  }
  return result
}
function assertPreviewScope(current) {
  // The explicitly authorized NFSE remote is checked in full before excluding
  // its exact section names from the unchanged historical baseline hash.
  assert.deepEqual([...current].filter(([name]) => name.startsWith(nfseRemote)),
    [...nfseSections], 'NFSE_PREVIEW_CONFIG_CHANGED')
  // Pin the normalized preexisting sections from main 18374bf. CI uses a shallow
  // checkout, so do not depend on an un-fetched historical Git object.
  const original = [...current].filter(([name]) =>
    !name.startsWith('remotes."hotfix/sacado-multi-cnpj"') && !nfseSections.has(name))
  assert.equal(createHash('sha256').update(JSON.stringify(original)).digest('hex'),
    'f433e29fd55575110ee29586a7a76feeb42e462dae42fd62a2763bd40eeb0e40', 'OTHER_CONFIG_CHANGED')
  assert.deepEqual([...current.keys()].filter(name => name.startsWith('remotes."hotfix/sacado-multi-cnpj"')), [
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
}

test('only the exact authorized SACADO and NFSE remote configurations are added', () => {
  assertPreviewScope(sections(config))
})

test.each([
  ['production project', nfseRemote, 'project_id = "wwsndnuvnjuabpbjwlck"'],
  ['homolog project', nfseRemote, 'project_id = "fhgkmggthxikfpogrvaa"'],
  ['RLX project', nfseRemote, 'project_id = "inkyqlmusvorcmibmrhp"'],
  ['NFSE migration replay', `${nfseRemote}.db.migrations`, 'enabled = true'],
  ['NFSE automatic seed', `${nfseRemote}.db.seed`, 'enabled = true'],
  ['NFSE extra setting', nfseRemote, 'project_id = "ettpaprrmpjsfkcystob"\nextra = true'],
  ['NFSE extra section', `${nfseRemote}.auth`, 'enabled = false'],
  ['similar remote name', 'remotes."hotfix/nfse-submit-frozen-facts-extra"', 'project_id = "ettpaprrmpjsfkcystob"'],
  ['unknown remote', 'remotes."unapproved"', 'project_id = "unapproved"'],
  ['global migrations', 'db.migrations', 'enabled = false\nschema_paths = []'],
  ['global seed', 'db.seed', 'enabled = false\nsql_paths = ["./seed.sql"]'],
  ['existing GUIBOR remote', 'remotes."release/guibor-prod-02".db.migrations', 'enabled = true'],
  ['existing HEALTH remote', 'remotes."hotfix/health-fiscal-import".db.seed', 'enabled = true'],
  ['existing SACADO remote', 'remotes."hotfix/sacado-multi-cnpj".db.migrations', 'enabled = true'],
])('rejects changes to %s', (_label, section, value) => {
  const changed = sections(config)
  assert(changed.get(section) !== value, 'MUTATION_MUST_CHANGE_CONFIG')
  changed.set(section, value)
  assert.throws(() => assertPreviewScope(changed), assert.AssertionError)
})

test.each([...nfseSections.keys()])('rejects missing authorized section %s', section => {
  const changed = sections(config)
  assert(changed.delete(section))
  assert.throws(() => assertPreviewScope(changed), /NFSE_PREVIEW_CONFIG_CHANGED/)
})

test('rejects duplicate sections instead of hiding an earlier override', () => {
  assert.throws(() => sections(`${config}\n[${nfseRemote}.db.migrations]\nenabled = true\n`),
    /DUPLICATE_CONFIG_SECTION/)
})

test('accepts the same configuration with LF and CRLF line endings', () => {
  const lf = config.replaceAll('\r\n', '\n')
  assertPreviewScope(sections(lf))
  assertPreviewScope(sections(lf.replaceAll('\n', '\r\n')))
})
test('manual preview target is pinned and no migration is implicitly authorized', () => {
  assert.equal(manifest.projectRef, 'yynlrtonrqxoatmuclrt')
  assert.equal(manifest.branchId, 'c31a3f44-0c5a-413d-8a39-b5d2eeda010e')
  assert.equal(manifest.mode, 'MANUAL_EXPLICIT_LIST')
  assert.equal(manifest.gitBranch, 'hotfix/sacado-multi-cnpj')
  assert.deepEqual(manifest.excludedVersions, ['20260929193129'])
  assert.equal(manifest.historicalDivergence, 'KNOWN_AND_PRESERVED')
  assert.equal(manifest.migrations.length, 1)
  const migration = manifest.migrations[0]
  assert.equal(migration.version, '20261005154435')
  assert.equal(migration.name, 'sacado_multi_cnpj_acessos')
  assert.equal(migration.file, `supabase/migrations/${migration.version}_${migration.name}.sql`)
  assert.equal(createHash('sha256').update(readFileSync(migration.file, 'utf8').replaceAll('\r\n', '\n')).digest('hex'), migration.sha256)
})
