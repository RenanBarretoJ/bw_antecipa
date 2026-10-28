'use server'

import { z } from 'zod'
import { requireRole } from '@/lib/auth/authorization'
import type { FiscalSituationView } from '@/lib/serpro-nfe/contracts'
import { scheduleSerproNfePickup } from '@/lib/serpro-nfe/dispatch.server'
import { readSerproNfeRuntimeConfig } from '@/lib/serpro-nfe/provider.server'

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>
}

const uuidSchema = z.string().uuid()
const requestReferenceSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/)

function isFiscalSituation(value: unknown): value is FiscalSituationView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.status === 'string'
    && typeof row.provider === 'string'
    && typeof row.severity === 'string'
    && typeof row.summary === 'string'
    && typeof row.consumptionMode === 'string'
    && Array.isArray(row.differences)
    && Array.isArray(row.events)
    && Array.isArray(row.history)
    && !!row.consumption
    && typeof row.consumption === 'object'
}

export async function obterSituacaoFiscalNfe(notaFiscalId: string) {
  const parsedNotaId = uuidSchema.safeParse(notaFiscalId)
  if (!parsedNotaId.success) return { success: false as const, message: 'Nota fiscal inválida.' }
  const context = await requireRole(['gestor', 'super_admin'])
  const db = context.supabase as unknown as RpcClient
  const { data, error } = await db.rpc('obter_situacao_fiscal_nfe', { p_nota_fiscal_id: parsedNotaId.data })
  if (error) return { success: false as const, message: 'Não foi possível carregar a situação fiscal.' }
  if (data === null) return { success: true as const, situation: null }
  if (!isFiscalSituation(data)) return { success: false as const, message: 'Retorno fiscal inválido.' }
  // A runtime kill switch also affects the affordance, without hiding the last
  // fiscal result or rewriting the database's immutable history.
  const situation = readSerproNfeRuntimeConfig().ready ? data : {
    ...data, capabilityState: 'VERIFIED_DISABLED' as const, consumptionMode: 'OFF_ZERO_BUDGET' as const,
  }
  return { success: true as const, situation }
}

export async function solicitarAtualizacaoSituacaoFiscalNfe(
  notaFiscalId: string,
  requestReference: string,
) {
  const parsed = z.object({
    notaFiscalId: uuidSchema,
    requestReference: requestReferenceSchema,
  }).safeParse({ notaFiscalId, requestReference })
  if (!parsed.success) {
    return { success: false as const, code: 'INVALID_INPUT', message: 'Solicitação inválida.' }
  }

  // A Server Action é uma entrada pública: papel, sessão MFA de login e Fundo
  // são revalidados no servidor/RPC. Nenhum actor, role ou chave fiscal vem do cliente.
  const context = await requireRole(['gestor', 'super_admin'])
  if (!readSerproNfeRuntimeConfig().ready) {
    return { success: false as const, code: 'PROVIDER_OFF', message: 'SERPRO desativado; nenhuma consulta foi enviada.' }
  }
  const db = context.supabase as unknown as RpcClient
  const { data, error } = await db.rpc('solicitar_reconsulta_nfe_fiscal_operacional', {
    p_nota_fiscal_id: parsed.data.notaFiscalId,
    p_request_reference: parsed.data.requestReference,
  })
  if (error) {
    return {
      success: false as const,
      code: 'FORBIDDEN',
      message: 'Não foi possível solicitar a reconsulta. Confirme sua sessão e o acesso ao Fundo.',
    }
  }

  const result = data as { accepted?: boolean; code?: string; requestId?: string; status?: string } | null
  if (result?.accepted) {
    scheduleSerproNfePickup()
    return {
      success: true as const,
      code: result.code || 'QUEUED',
      requestId: result.requestId,
      message: result.code === 'IDEMPOTENT_REPLAY'
        ? 'Esta mesma solicitação já foi registrada.'
        : 'Reconsulta SERPRO solicitada.',
    }
  }
  if (result?.code === 'PROVIDER_OFF') {
    return {
      success: false as const,
      code: result.code,
      message: 'SERPRO permanece desativado; a solicitação foi registrada sem chamada externa.',
    }
  }
  if (result?.code === 'NOT_ELIGIBLE') {
    return { success: false as const, code: result.code, message: 'Esta nota não possui identidade fiscal elegível.' }
  }
  return {
    success: false as const,
    code: result?.code || 'NOT_QUEUED',
    message: 'Já existe uma consulta em andamento ou o provider está indisponível.',
  }
}
