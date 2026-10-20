/** Bound work and fail on truncation; do not treat a PostgREST page as a full snapshot. */
export async function carregarPaginasFinanceiras<T>(query: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null
}>): Promise<T[]> {
  const rows: T[] = []
  const pageSize = 500
  for (let from = 0; from <= 100_000; from += pageSize) {
    const result = await query(from, from + pageSize - 1)
    if (result.error) throw new Error(`Nao foi possivel carregar a base financeira: ${result.error.message}`)
    const page = result.data ?? []
    rows.push(...page)
    if (rows.length > 100_000) throw new Error('Base financeira acima do limite de processamento integral.')
    if (page.length < pageSize) return rows
  }
  throw new Error('Base financeira incompleta: paginacao excedeu o limite.')
}
