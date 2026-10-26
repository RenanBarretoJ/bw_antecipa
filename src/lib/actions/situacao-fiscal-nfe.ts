'use server'

import { requireRole } from '@/lib/auth/authorization'
import type { FiscalSituationView } from '@/lib/serpro-nfe/contracts'

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>
}

function isFiscalSituation(value: unknown): value is FiscalSituationView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.status === 'string'
    && typeof row.provider === 'string'
    && typeof row.severity === 'string'
    && typeof row.summary === 'string'
    && Array.isArray(row.differences)
    && Array.isArray(row.events)
}

export async function obterSituacaoFiscalNfe(notaFiscalId: string) {
  const context = await requireRole(['gestor', 'super_admin'])
  const db = context.supabase as unknown as RpcClient
  const { data, error } = await db.rpc('obter_situacao_fiscal_nfe', { p_nota_fiscal_id: notaFiscalId })
  if (error) return { success: false as const, message: 'Não foi possível carregar a situação fiscal.' }
  if (data === null) return { success: true as const, situation: null }
  if (!isFiscalSituation(data)) return { success: false as const, message: 'Retorno fiscal inválido.' }
  return { success: true as const, situation: data }
}

export async function solicitarAtualizacaoSituacaoFiscalNfe(notaFiscalId: string) {
  const context = await requireRole(['gestor', 'super_admin'])
  const db = context.supabase as unknown as RpcClient
  const { data, error } = await db.rpc('solicitar_reconsulta_nfe_fiscal', { p_nota_fiscal_id: notaFiscalId })
  if (error) return { success: false as const, code: 'FORBIDDEN', message: 'Não foi possível solicitar a atualização.' }
  const result = data as { accepted?: boolean; code?: string } | null
  if (result?.accepted) return { success: true as const, code: 'QUEUED', message: 'Atualização enfileirada.' }
  if (result?.code === 'CAPABILITY_UNVERIFIED') {
    return { success: false as const, code: result.code, message: 'Capacidade contratual ainda não validada; nenhuma consulta foi enviada.' }
  }
  if (result?.code === 'RATE_LIMITED') {
    return { success: false as const, code: result.code, message: 'Aguarde antes de solicitar outra atualização.' }
  }
  return { success: false as const, code: result?.code || 'NOT_QUEUED', message: 'A consulta já está em andamento ou indisponível.' }
}
