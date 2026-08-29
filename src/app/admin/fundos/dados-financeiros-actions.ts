'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import { ingerirArquivoFinanceiro } from '@/lib/financeiro/ingestao/ingestao.server'
import { TIPOS_BASE_FINANCEIROS } from '@/lib/financeiro/ingestao/types'

type ActionResult = {
  success: boolean
  message: string
  data?: Record<string, unknown>
  notification?: { type: 'success' | 'error' | 'warning' | 'info'; message: string; details?: string }
}

const uploadSchema = z.object({
  fundoId: z.string().uuid(),
  provedor: z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9._-]+$/i),
  tipoBase: z.enum(TIPOS_BASE_FINANCEIROS),
  dataReferencia: z.iso.date(),
})

const publishSchema = z.object({
  fundoId: z.string().uuid(),
  importacaoId: z.string().uuid(),
  mfaCode: z.string().regex(/^\d{6}$/),
})

const emptyDeclarationSchema = z.object({
  fundoId: z.string().uuid(),
  provedor: z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9._-]+$/i),
  tipoBase: z.enum(['AQUISICOES', 'LIQUIDACOES']),
  dataReferencia: z.iso.date(),
})

function errorResult(message: string, details?: string): ActionResult {
  return { success: false, message, notification: { type: 'error', message, details } }
}

export async function registrarBaseSemMovimentoAction(input: unknown): Promise<ActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = emptyDeclarationSchema.safeParse(input)
    if (!parsed.success) return errorResult('Revise os dados da declaracao sem movimento.')
    const context = await requireSuperAdmin()
    const { data, error } = await context.supabase.rpc('registrar_importacao_financeira_sem_movimento', {
      p_fundo_id: parsed.data.fundoId,
      p_tipo_base: parsed.data.tipoBase,
      p_data_referencia: parsed.data.dataReferencia,
      p_provedor: parsed.data.provedor,
      p_layout_nome: `${parsed.data.tipoBase}_SEM_MOVIMENTO_V1`,
      p_versao_layout: 'RLX_V1',
      p_origem: 'MANUAL',
      p_correlation_id: correlationId,
    })
    if (error) throw error
    revalidatePath(`/admin/fundos/${parsed.data.fundoId}`)
    return { success: true, message: 'Declaracao sem movimento registrada e pronta para publicacao.', data: data as Record<string, unknown>, notification: { type: 'success', message: 'Declaracao sem movimento registrada.' } }
  } catch (error) {
    console.error('[rlx/sem-movimento]', { correlationId, message: error instanceof Error ? error.message : 'unknown' })
    return errorResult('Nao foi possivel registrar a declaracao sem movimento.', `Referencia: ${correlationId}`)
  }
}

export async function importarBaseFinanceiraAction(formData: FormData): Promise<ActionResult> {
  const correlationId = randomUUID()
  try {
    const context = await requireSuperAdmin()
    const parsed = uploadSchema.safeParse(Object.fromEntries(formData.entries()))
    if (!parsed.success) return errorResult('Revise os dados da importacao.')
    const arquivo = formData.get('arquivo')
    if (!(arquivo instanceof File)) return errorResult('Selecione um arquivo CSV.')
    const result = await ingerirArquivoFinanceiro({
      ...parsed.data,
      arquivo: new Uint8Array(await arquivo.arrayBuffer()),
      nomeArquivo: arquivo.name,
      mimeType: arquivo.type,
      origem: 'MANUAL',
      atorUsuarioId: context.user.id,
    })
    revalidatePath(`/admin/fundos/${parsed.data.fundoId}`)
    const message = result.duplicada
      ? 'Este arquivo ja havia sido processado; a importacao existente foi reutilizada.'
      : result.status === 'VALIDA'
        ? 'Arquivo validado e pronto para publicacao.'
        : 'Arquivo preservado, mas a validacao encontrou inconsistencias.'
    return { success: true, message, data: { id: result.importacaoId }, notification: { type: result.status === 'VALIDA' ? 'success' : 'warning', message } }
  } catch (error) {
    console.error('[rlx/importacao]', { correlationId, message: error instanceof Error ? error.message : 'unknown' })
    return errorResult('Nao foi possivel processar a base financeira.', `Referencia: ${correlationId}`)
  }
}

export async function publicarBaseFinanceiraAction(input: unknown): Promise<ActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = publishSchema.safeParse(input)
    if (!parsed.success) return errorResult('Confirmacao de publicacao invalida.')
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'publicar_base_financeira', parsed.data.mfaCode)
    const { data, error } = await context.supabase.rpc('publicar_importacao_financeira', {
      p_importacao_id: parsed.data.importacaoId,
      p_correlation_id: correlationId,
    })
    if (error) throw error
    revalidatePath(`/admin/fundos/${parsed.data.fundoId}`)
    return { success: true, message: 'Base financeira publicada.', data: data as Record<string, unknown>, notification: { type: 'success', message: 'Base financeira publicada.' } }
  } catch (error) {
    console.error('[rlx/publicacao]', { correlationId, message: error instanceof Error ? error.message : 'unknown' })
    return errorResult('Nao foi possivel publicar a base financeira.', `Referencia: ${correlationId}`)
  }
}
