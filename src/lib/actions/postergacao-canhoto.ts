'use server'

import { revalidatePath } from 'next/cache'
import { requireNotaFiscalAccess } from '@/lib/auth/authorization'

export type ComunicarPostergacaoCanhotoResult = {
  success: boolean
  message: string
  data?: {
    id: string
    nota_fiscal_id: string
    nota_fiscal_entrega_id: string
    prazo_original_upload_canhoto: string
    nova_previsao_upload_canhoto: string
    motivo_postergacao: string
    limite_postergacao_dias_aplicado: number
    postergacao_comunicada_em: string
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function mensagemPostergacao(errorMessage: string): string {
  const knownMessages = [
    'A nova previsao',
    'A postergação',
    'A politica',
    'A entrega',
    'A operacao',
    'O canhoto',
    'O limite',
    'O prazo',
    'O snapshot',
    'Somente o cedente',
    'Cedente autenticado',
    'Contexto operacional',
    'Informe o motivo',
    'Nota fiscal',
  ]
  return knownMessages.some((prefix) => errorMessage.startsWith(prefix))
    ? errorMessage
    : 'Não foi possível registrar a nova previsão de upload do canhoto.'
}

export async function comunicarPostergacaoUploadCanhoto(input: {
  notaFiscalId: string
  novaPrevisao: string
  motivo: string
}): Promise<ComunicarPostergacaoCanhotoResult> {
  if (!input.notaFiscalId || !DATE_ONLY.test(input.novaPrevisao) || !input.motivo.trim()) {
    return { success: false, message: 'Informe a nova previsão e o motivo.' }
  }
  if (input.motivo.trim().length > 1000) {
    return { success: false, message: 'O motivo deve ter no máximo 1000 caracteres.' }
  }

  try {
    const context = await requireNotaFiscalAccess(input.notaFiscalId)
    if (context.profile.role !== 'cedente') {
      return { success: false, message: 'Somente o cedente pode informar a nova previsão.' }
    }

    const { data, error } = await context.supabase.rpc('comunicar_postergacao_upload_canhoto', {
      p_nota_fiscal_id: input.notaFiscalId,
      p_nova_previsao: input.novaPrevisao,
      p_motivo: input.motivo.trim(),
    })
    if (error) return { success: false, message: mensagemPostergacao(error.message) }
    if (!data || typeof data !== 'object') {
      return { success: false, message: 'A nova previsão não foi confirmada pelo banco.' }
    }

    revalidatePath(`/cedente/notas-fiscais/${input.notaFiscalId}`)
    revalidatePath(`/gestor/notas-fiscais/${input.notaFiscalId}`)
    return {
      success: true,
      message: 'Nova previsão de upload do canhoto comunicada aos gestores.',
      data: data as ComunicarPostergacaoCanhotoResult['data'],
    }
  } catch (error) {
    return {
      success: false,
      message: mensagemPostergacao(error instanceof Error ? error.message : ''),
    }
  }
}
