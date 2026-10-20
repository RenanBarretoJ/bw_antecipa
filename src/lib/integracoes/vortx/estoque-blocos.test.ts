import { describe, expect, it } from 'vitest'
import { blocosEstoqueVortx, MAX_STOCK_CHUNK_BYTES } from './estoque-blocos'
describe('bounded stock transport chunks', () => {
  it('preserves all rows/order with a hard 500-row chunk limit', () => {
    const rows = Array.from({ length: 1200 }, (_, numero_linha) => ({ numero_linha }))
    const chunks = [...blocosEstoqueVortx(rows)]
    expect(chunks.map(chunk => chunk.linhas.length)).toEqual([500, 500, 200])
    expect(chunks.map(chunk => chunk.ordem)).toEqual([1, 2, 3])
    expect(chunks.flatMap(chunk => chunk.linhas)).toEqual(rows)
  })
  it('accounts for UTF-8 bytes, not JavaScript character length', () => {
    const rows = Array.from({ length: 300 }, (_, id) => ({ id, text: 'á'.repeat(10000) }))
    const chunks = [...blocosEstoqueVortx(rows)]
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.bytes).toBe(Buffer.byteLength(JSON.stringify(chunk.linhas)))
      expect(chunk.bytes).toBeLessThanOrEqual(MAX_STOCK_CHUNK_BYTES)
    }
    expect(chunks.flatMap(chunk => chunk.linhas)).toEqual(rows)
  })
  it('never emits an empty chunk or silently truncates an oversized row', () => {
    expect([...blocosEstoqueVortx([])]).toEqual([])
    expect(() => [...blocosEstoqueVortx([{ value: 'a'.repeat(MAX_STOCK_CHUNK_BYTES) }])]).toThrow('limite')
  })
})
