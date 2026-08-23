'use server'

import { requireNotaFiscalAccess } from '@/lib/auth/authorization'

type ActionResult<T = undefined> = { success: boolean; message: string; data?: T; details?: string }

export type CanhotoDaEntregaRegistro = {
  id: string
  status: string
  nome_recebedor: string | null
  possui_ressalva: boolean
  descricao_ressalva: string | null
  nota_fiscal_remessa_id: string | null
  remessa_numero: string | null
  documento_versao_atual_id: string | null
  created_at: string
}

export type ContextoCanhotoDaNota = {
  aplicavel: boolean
  entregaId: string | null
  canhotos: CanhotoDaEntregaRegistro[]
}

/**
 * Contexto de canhoto para o card "Entrega / Canhoto" na pagina da NF de
 * venda: resolve a entrega ativa (se houver operacao/pos-cessao) e lista os
 * canhotos ja enviados, com o rotulo "Entrega comprovada via NF de Remessa
 * <numero>" quando aplicavel (regra F do ticket NF de Remessa).
 */
export async function carregarContextoCanhotoDaNota(notaFiscalId: string): Promise<ActionResult<ContextoCanhotoDaNota>> {
  try {
    const context = await requireNotaFiscalAccess(notaFiscalId)
    const { data: entrega, error: entregaError } = await context.supabase
      .from('nota_fiscal_entregas')
      .select('id, status_entrega')
      .eq('nota_fiscal_id', notaFiscalId)
      .not('status_entrega', 'in', '(nao_aplicavel,cancelada,devolvida)')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (entregaError) throw new Error(entregaError.message)
    if (!entrega) return { success: true, message: 'NF sem acompanhamento logistico ativo.', data: { aplicavel: false, entregaId: null, canhotos: [] } }

    const { data: canhotos, error: canhotosError } = await context.supabase
      .from('canhotos')
      .select('id, status, nome_recebedor, possui_ressalva, descricao_ressalva, nota_fiscal_remessa_id, documento_versao_atual_id, created_at')
      .eq('nota_fiscal_entrega_id', entrega.id)
      .order('created_at', { ascending: false })
    if (canhotosError) throw new Error(canhotosError.message)

    const remessaIds = [...new Set((canhotos || []).map((c) => c.nota_fiscal_remessa_id).filter((id): id is string => Boolean(id)))]
    const remessasPorId = new Map<string, string | null>()
    if (remessaIds.length > 0) {
      const { data: remessas } = await context.supabase.from('nota_fiscal_remessas').select('id, numero').in('id', remessaIds)
      for (const r of remessas || []) remessasPorId.set(r.id, r.numero)
    }

    return {
      success: true,
      message: 'Contexto carregado.',
      data: {
        aplicavel: true,
        entregaId: entrega.id,
        canhotos: (canhotos || []).map((c) => ({
          ...c,
          remessa_numero: c.nota_fiscal_remessa_id ? remessasPorId.get(c.nota_fiscal_remessa_id) ?? null : null,
        })),
      },
    }
  } catch (error) {
    return { success: false, message: 'Nao foi possivel carregar o contexto de canhoto desta NF.', details: error instanceof Error ? error.message : 'Erro inesperado.' }
  }
}
