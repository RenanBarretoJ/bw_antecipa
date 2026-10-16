import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import { arquivoOriginalDaNotaValido } from './avaliacao-checklist-aprovacao'

/**
 * Recebe exclusivamente IDs de NFs já carregadas pelo cliente autenticado/RLS.
 * O journal é privado: a consulta privilegiada apenas resolve os originais
 * dessas NFs, sem escolher versões posteriores nem emitir URLs assinadas.
 */
export async function carregarOriginaisFiscaisCanonicos(
  notasAutorizadas: Array<{ id: string; fiscal_reservation_id: string | null }>,
): Promise<Map<string, string>> {
  const ids = [...new Set(notasAutorizadas.filter(nota => nota.fiscal_reservation_id).map(nota => nota.id))]
  const originais = new Map<string, string>()
  if (!ids.length) return originais

  const { data, error } = await createAdminClient().rpc('fiscal_intake_get_originals', { p_nf_ids: ids })
  if (error || !Array.isArray(data)) {
    throw new Error('Não foi possível validar os arquivos originais. Tente novamente em instantes.')
  }
  const autorizadas = new Set(ids)
  for (const original of data) {
    if (!original || typeof original !== 'object'
      || !autorizadas.has(original.nota_fiscal_id)
      || !['notas-fiscais', 'documentos-v2'].includes(original.bucket)
      || typeof original.path !== 'string'
      || !arquivoOriginalDaNotaValido(original.path)) continue
    originais.set(original.nota_fiscal_id, original.path)
  }
  return originais
}
