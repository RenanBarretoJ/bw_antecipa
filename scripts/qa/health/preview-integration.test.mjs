import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { manifest, loadHealthMigration, validateMigrationSource } from './migration-manifest.mjs'

const config = readFileSync('supabase/config.toml', 'utf8')
function section(name) {
  const header = `[${name}]`
  const start = config.indexOf(header)
  expect(start).toBeGreaterThanOrEqual(0)
  return config.slice(start + header.length).split(/^\[/m)[0]
}
describe('HEALTH Preview explicit migration scope', () => {
  it('does not disable global migrations or seed, or configure production/homolog', () => {
    for (const name of ['db.migrations', 'db.seed']) expect(section(name)).toMatch(/^enabled = true$/m)
    expect(config).not.toMatch(/^\[remotes\.(?:"?(?:main|production|homolog)"?)(?:\.|\])/m)
  })
  it('pins automatic replay/seed exception to existing HEALTH Preview', () => {
    expect(section('remotes."hotfix/health-fiscal-import"')).toMatch(/^project_id = "mkfslrspxzplghjeixjq"$/m)
    for (const name of ['db.migrations', 'db.seed']) expect(section(`remotes."hotfix/health-fiscal-import".${name}`)).toMatch(/^enabled = false$/m)
  })
  it('accepts only the single exact, LF-normalized certified migration', () => {
    expect(loadHealthMigration().sha256).toBe(manifest.migrations[0].sha256)
    expect(manifest.migrations).toHaveLength(1)
    expect(manifest.excludedVersions).toEqual(['20260929193129'])
    expect(manifest.historicalDivergence).toBe('KNOWN_AND_PRESERVED')
  })
  it('rejects changed SQL and accepts only line-ending normalization', () => {
    const entry = loadHealthMigration()
    expect(validateMigrationSource(entry, entry.source.replaceAll('\n', '\r\n'))).toBe(entry.source)
    expect(() => validateMigrationSource(entry, entry.source + '\n-- drift')).toThrow('MIGRATION_HASH_MISMATCH')
  })
  it.each(['file', 'version', 'name', 'sha256'])('rejects changed migration %s', field => {
    const entry = loadHealthMigration()
    expect(() => validateMigrationSource({ ...entry, [field]: 'unexpected' }, entry.source)).toThrow()
  })
})
