type NotaLote = {
  id: string; numero_nf: string; cedente_id: string
  fundo_id: string | null; cedente_fundo_id: string | null; updated_at?: string
}

/** Never merge the same company's notes from different operational links. */
export function agruparAvisosNotas(notas: NotaLote[]) {
  const grupos = new Map<string, { vinculoId: string; notas: NotaLote[] }>()
  for (const nota of notas) {
    if (!nota.fundo_id || !nota.cedente_fundo_id) continue // fail closed: no guessed scope
    const key = `${nota.fundo_id}:${nota.cedente_fundo_id}:${nota.cedente_id}`
    const grupo = grupos.get(key) ?? { vinculoId: nota.cedente_fundo_id, notas: [] }
    grupo.notas.push(nota)
    grupos.set(key, grupo)
  }
  return [...grupos.values()]
}
