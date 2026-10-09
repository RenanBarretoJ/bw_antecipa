import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const config = readFileSync('supabase/config.toml', 'utf8')
function section(name) {
  const header = `[${name}]`
  const start = config.indexOf(header)
  expect(start, `missing ${header}`).toBeGreaterThanOrEqual(0)
  return config.slice(start + header.length).split(/^\[/m)[0]
}

describe('GUIBOR release Preview integration isolation', () => {
  it('keeps migrations enabled by default outside the dedicated Preview', () => {
    expect(section('db.migrations')).toMatch(/^enabled = true$/m)
  })
  it('pins the remote to the certified Preview only', () => {
    expect(section('remotes."release/guibor-prod-02"')).toMatch(/^project_id = "rnrlbqulmrtzirlpopod"$/m)
    expect(config).not.toMatch(/^\[remotes\.(?:"?(?:main|production|homolog)"?)(?:\.|\])/m)
  })
  it('prevents automatic migration replay and seeding on that Preview', () => {
    expect(section('remotes."release/guibor-prod-02".db.migrations')).toMatch(/^enabled = false$/m)
    expect(section('remotes."release/guibor-prod-02".db.seed')).toMatch(/^enabled = false$/m)
  })
  it('preserves every certified migration byte for byte after LF normalization', () => {
    const expected = [
      ['20260929154656_guibor_nfse_fiscal_provenance.sql', '6764965cb3be144ff3604f7aa294aafc62e90270a72d2a4d7104689571e31d76'],
      ['20260929174520_guibor_nfse_review_intents.sql', '740cc2ac6f70cb2341f06853496c0394229fa0f0849518f9357204e286ba4f39'],
      ['20260929191004_guibor_a5_base_antecipacao.sql', 'b0ee16a0179012da540956d9df4fb6f456dbf81c85015ea681ff52959148f940'],
      ['20260929215557_guibor_a6_decouple_c5.sql', '8c05f9c58df7bff55959c972c64268191ea010cad15a9df2bafbf18d12191d85'],
    ]
    for (const [file, hash] of expected) {
      const sql = readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/\r\n/g, '\n')
      expect(createHash('sha256').update(sql).digest('hex')).toBe(hash)
    }
  })
})
