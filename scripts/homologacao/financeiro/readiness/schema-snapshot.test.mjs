import { describe, expect, it } from 'vitest'
import { compareSchemaSnapshots } from './schema-snapshot.mjs'

const categories = [
  'schemas', 'relations', 'columns', 'types', 'constraints', 'indexes', 'views',
  'routines', 'triggers', 'policies', 'grants', 'sequences', 'storage_buckets',
]

function snapshot(overrides = {}) {
  return Object.assign(Object.fromEntries(categories.map((category) => [category, []])), {
    counts: {},
    ...overrides,
  })
}

describe('schema parity P2.6.3', () => {
  it('aprova snapshots semanticamente identicos', () => {
    const base = snapshot({ schemas: [{ schema: 'public' }] })
    expect(compareSchemaSnapshots(base, structuredClone(base))).toMatchObject({
      status: 'PASS', material_differences: [], allowed_differences: [],
    })
  })

  it('allowlista somente o objeto Iceberg exato do Storage local', () => {
    const homolog = snapshot()
    const cleanRoom = snapshot({
      relations: [{ schema: 'storage', name: 'iceberg_tables', relkind: 'r' }],
    })
    const result = compareSchemaSnapshots(homolog, cleanRoom)
    expect(result.status).toBe('PASS')
    expect(result.material_differences).toHaveLength(0)
    expect(result.allowed_differences).toHaveLength(1)
  })

  it('mantem grant publico divergente como material', () => {
    const homolog = snapshot({
      grants: [{ kind: 'table', schema: 'public', relation: 'operacoes', grantee: 'anon', privilege_type: 'SELECT' }],
    })
    const result = compareSchemaSnapshots(homolog, snapshot())
    expect(result.status).toBe('FAIL')
    expect(result.material_differences).toHaveLength(1)
    expect(result.allowed_differences).toHaveLength(0)
  })
})
