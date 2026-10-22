export const CENTRAL_BASES_GESTOR = '/gestor/central-bases'

/** Preserve supported navigation state, never a caller-provided destination or Fund. */
export function destinoCentralBases(query: Readonly<Record<string, string | string[] | undefined>>, fundoId?: string): string {
  const params = new URLSearchParams()
  if (fundoId !== undefined) params.set('tab', 'central-bases')
  for (const key of ['pagina', 'tipo', 'origem', 'estado', 'referencia', 'carteiraPagina', 'carteiraEstado', 'carteiraReferencia']) {
    const value = query[key]
    if (typeof value === 'string') params.set(key, value)
  }
  const path = fundoId === undefined ? CENTRAL_BASES_GESTOR : `/admin/fundos/${encodeURIComponent(fundoId)}`
  return `${path}${params.size ? `?${params.toString()}` : ''}`
}
