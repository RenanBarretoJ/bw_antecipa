export const MAX_STOCK_CHUNK_ROWS = 500
export const MAX_STOCK_CHUNK_BYTES = 2 * 1024 * 1024 - 4096 // Leave room for the RPC envelope.

/** Bounded wire serialization. Rows are referenced, not copied or flattened into a giant JSON string. */
export function* blocosEstoqueVortx<T>(rows: readonly T[]): Generator<{ ordem: number; linhas: T[]; bytes: number }> {
  let linhas: T[] = [], bytes = 2, ordem = 1
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row), 'utf8')
    if (size + 2 > MAX_STOCK_CHUNK_BYTES) throw new Error('Linha de estoque excede o limite de transporte.')
    if (linhas.length && (linhas.length === MAX_STOCK_CHUNK_ROWS || bytes + size + 1 > MAX_STOCK_CHUNK_BYTES)) {
      yield { ordem: ordem++, linhas, bytes }; linhas = []; bytes = 2
    }
    bytes += size + (linhas.length ? 1 : 0); linhas.push(row)
  }
  if (linhas.length) yield { ordem, linhas, bytes }
}
