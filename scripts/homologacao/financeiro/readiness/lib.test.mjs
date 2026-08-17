import { describe, expect, it } from 'vitest'
import { compareMigrationHistory, sha256 } from './lib.mjs'

describe('P2.6.1 readiness helpers', () => {
  it('compara o historico sem mascarar migrations ausentes', () => {
    const inventory = {
      total: 2,
      migrations: [
        { timestamp: '001', filename: '001_a.sql', nome: 'a', sha256: 'a' },
        { timestamp: '002', filename: '002_b.sql', nome: 'b', sha256: 'b' },
      ],
    }
    const result = compareMigrationHistory(inventory, [{ version: '001', name: 'a' }])
    expect(result.aligned).toBe(false)
    expect(result.missing_remote).toEqual([{ version: '002', filename: '002_b.sql', sha256: 'b' }])
  })

  it('produz checksum deterministico', () => {
    expect(sha256('BW Antecipa')).toBe(sha256('BW Antecipa'))
    expect(sha256('BW Antecipa')).not.toBe(sha256('BW Antecipa '))
  })
})
