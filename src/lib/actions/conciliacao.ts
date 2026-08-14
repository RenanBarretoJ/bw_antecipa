'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { obterFundoAtivoAutorizado } from '@/lib/actions/fundo-ativo'
import { requireGestor } from '@/lib/auth/authorization'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import {
  executarConciliacaoFinanceira,
  executarMatchingFinanceiro,
} from '@/lib/rlx/conciliacao/processor.server'
import { executarPosicaoLogisticaFinanceira } from '@/lib/rlx/logistica/processor.server'

export type ConciliacaoActionResult = {
  success: boolean
  message: string
  data?: Record<string, unknown>
  notification: {
    type: 'success' | 'error' | 'warning' | 'info'
    message: string
    details?: string
  }
}

const executionSchema = z.object({ dataReferencia: z.iso.date() })
const manualSchema = z.object({
  matchingResultadoId: z.string().uuid(),
  notaFiscalId: z.string().uuid(),
  motivo: z.string().trim().min(5).max(500),
  codigoTotp: z.string().regex(/^\d{6}$/),
})
const revokeSchema = z.object({
  vinculoId: z.string().uuid(),
  motivo: z.string().trim().min(5).max(500),
  codigoTotp: z.string().regex(/^\d{6}$/),
})
const noteSearchSchema = z.object({ q: z.string().trim().min(2).max(120) })

function failure(message: string, correlationId: string, error?: unknown): ConciliacaoActionResult {
  console.error('[rlx/conciliacao]', {
    correlationId,
    message: error instanceof Error ? error.message : String(error || 'unknown'),
  })
  return {
    success: false,
    message,
    notification: { type: 'error', message, details: `Referencia: ${correlationId}` },
  }
}

async function gestorNoFundoAtivo() {
  const [context, fundo] = await Promise.all([requireGestor(), obterFundoAtivoAutorizado()])
  if (!fundo.fundoId) throw new Error('Nenhum fundo ativo autorizado foi encontrado.')
  return { context, fundoId: fundo.fundoId }
}

export async function executarMatchingAction(input: unknown): Promise<ConciliacaoActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = executionSchema.safeParse(input)
    if (!parsed.success) return failure('Informe uma data de referencia valida.', correlationId)
    const { context, fundoId } = await gestorNoFundoAtivo()
    const result = await executarMatchingFinanceiro({
      fundoId,
      dataReferencia: parsed.data.dataReferencia,
      atorUsuarioId: context.user.id,
    })
    revalidatePath('/gestor/conciliacao')
    return {
      success: true,
      message: 'Matching financeiro executado.',
      data: result,
      notification: { type: 'success', message: 'Matching financeiro executado.' },
    }
  } catch (error) {
    return failure('Nao foi possivel executar o matching financeiro.', correlationId, error)
  }
}

export async function executarConciliacaoAction(input: unknown): Promise<ConciliacaoActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = executionSchema.safeParse(input)
    if (!parsed.success) return failure('Informe uma data de referencia valida.', correlationId)
    const { context, fundoId } = await gestorNoFundoAtivo()
    const result = await executarConciliacaoFinanceira({
      fundoId,
      dataReferencia: parsed.data.dataReferencia,
      atorUsuarioId: context.user.id,
    })
    revalidatePath('/gestor/conciliacao')
    const incomplete = result.status === 'BASE_INCOMPLETA'
    const message = incomplete
      ? 'A conciliacao foi registrada como base incompleta.'
      : 'Conciliacao financeira executada.'
    return {
      success: true,
      message,
      data: result,
      notification: { type: incomplete ? 'warning' : 'success', message },
    }
  } catch (error) {
    return failure('Nao foi possivel executar a conciliacao financeira.', correlationId, error)
  }
}

export async function executarPosicaoLogisticaAction(input: unknown): Promise<ConciliacaoActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = executionSchema.safeParse(input)
    if (!parsed.success) return failure('Informe uma data de referencia valida.', correlationId)
    const { context, fundoId } = await gestorNoFundoAtivo()
    const result = await executarPosicaoLogisticaFinanceira({
      fundoId,
      dataReferencia: parsed.data.dataReferencia,
      atorUsuarioId: context.user.id,
    })
    revalidatePath('/gestor/conciliacao')
    return {
      success: true,
      message: 'Posicao logistica financeira executada.',
      data: result,
      notification: { type: 'success', message: 'Posicao logistica financeira executada.' },
    }
  } catch (error) {
    return failure('Nao foi possivel executar a posicao logistica financeira.', correlationId, error)
  }
}

export async function pesquisarNotasParaMatchingAction(input: unknown): Promise<ConciliacaoActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = noteSearchSchema.safeParse(input)
    if (!parsed.success) return failure('Informe ao menos dois caracteres para pesquisar.', correlationId)
    const { context, fundoId } = await gestorNoFundoAtivo()
    const safeQuery = parsed.data.q.replace(/[%(),]/g, ' ').replace(/\s+/g, ' ').trim()
    const digits = safeQuery.replace(/\D/g, '')
    let query = context.supabase
      .from('notas_fiscais')
      .select('id,numero_nf,chave_acesso,razao_social_emitente,cnpj_emitente,razao_social_destinatario,cnpj_destinatario,data_vencimento,valor_bruto')
      .eq('fundo_id', fundoId)
      .order('created_at', { ascending: false })
      .limit(20)
    query = digits.length >= 6
      ? query.or(`numero_nf.ilike.%${digits}%,chave_acesso.ilike.%${digits}%,cnpj_emitente.ilike.%${digits}%,cnpj_destinatario.ilike.%${digits}%`)
      : query.or(`numero_nf.ilike.%${safeQuery}%,razao_social_emitente.ilike.%${safeQuery}%,razao_social_destinatario.ilike.%${safeQuery}%`)
    const { data, error } = await query
    if (error) throw error
    return {
      success: true,
      message: `${data?.length || 0} nota(s) encontrada(s).`,
      data: { notas: data || [] },
      notification: { type: 'info', message: `${data?.length || 0} nota(s) encontrada(s).` },
    }
  } catch (error) {
    return failure('Nao foi possivel pesquisar notas fiscais.', correlationId, error)
  }
}

export async function confirmarMatchManualAction(input: unknown): Promise<ConciliacaoActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = manualSchema.safeParse(input)
    if (!parsed.success) return failure('Revise a nota, o motivo e o codigo TOTP.', correlationId)
    const { context } = await gestorNoFundoAtivo()
    await autorizarEConsumirAcaoSensivel(context, 'confirmar_match_manual', parsed.data.codigoTotp)
    const { data, error } = await context.supabase.rpc('rlx_confirmar_match_manual', {
      p_matching_resultado_id: parsed.data.matchingResultadoId,
      p_nota_fiscal_id: parsed.data.notaFiscalId,
      p_motivo: parsed.data.motivo,
      p_correlation_id: correlationId,
    })
    if (error) throw error
    revalidatePath('/gestor/conciliacao')
    return {
      success: true,
      message: 'Associacao manual confirmada.',
      data: { vinculoId: String(data) },
      notification: { type: 'success', message: 'Associacao manual confirmada.' },
    }
  } catch (error) {
    return failure('Nao foi possivel confirmar a associacao manual.', correlationId, error)
  }
}

export async function revogarMatchManualAction(input: unknown): Promise<ConciliacaoActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = revokeSchema.safeParse(input)
    if (!parsed.success) return failure('Revise o motivo e o codigo TOTP.', correlationId)
    const { context } = await gestorNoFundoAtivo()
    await autorizarEConsumirAcaoSensivel(context, 'revogar_match_manual', parsed.data.codigoTotp)
    const { data, error } = await context.supabase.rpc('rlx_revogar_match_manual', {
      p_vinculo_id: parsed.data.vinculoId,
      p_motivo: parsed.data.motivo,
      p_correlation_id: correlationId,
    })
    if (error || data !== true) throw error || new Error('A revogacao nao foi confirmada.')
    revalidatePath('/gestor/conciliacao')
    return {
      success: true,
      message: 'Associacao manual revogada.',
      notification: { type: 'success', message: 'Associacao manual revogada.' },
    }
  } catch (error) {
    return failure('Nao foi possivel revogar a associacao manual.', correlationId, error)
  }
}
