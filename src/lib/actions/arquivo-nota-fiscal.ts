'use server'

import { requireNotaFiscalAccess } from '@/lib/auth/authorization'
import { buckets } from '@/lib/storage'
import { createAdminClient } from '@/lib/supabase/server'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIGNED_URL_TTL_SECONDS = 10 * 60

export type ArquivoNotaFiscalResult = {
  success: boolean
  message?: string
  url?: string
}

/**
 * Autoriza pela NF, resolve o caminho registrado no servidor e somente entao
 * usa a service role para assinar o objeto privado. O cliente nunca escolhe o
 * bucket nem envia um caminho de Storage.
 */
export async function obterUrlArquivoNotaFiscal(
  notaFiscalId: string,
): Promise<ArquivoNotaFiscalResult> {
  if (!UUID_PATTERN.test(notaFiscalId)) {
    return { success: false, message: 'Nota fiscal invalida.' }
  }

  try {
    const context = await requireNotaFiscalAccess(notaFiscalId)
    const { data: nota, error } = await context.supabase
      .from('notas_fiscais')
      .select('id, arquivo_url')
      .eq('id', notaFiscalId)
      .maybeSingle()

    if (error || !nota) {
      return { success: false, message: 'Nota fiscal nao encontrada.' }
    }
    if (!nota.arquivo_url) {
      return { success: false, message: 'Esta nota fiscal nao possui arquivo original.' }
    }

    const { data, error: signedError } = await createAdminClient().storage
      .from(buckets.notasFiscais)
      .createSignedUrl(nota.arquivo_url, SIGNED_URL_TTL_SECONDS)

    if (signedError || !data?.signedUrl) {
      console.error('[storage][nota-fiscal] Falha ao assinar objeto autorizado.', {
        notaFiscalId,
        role: context.profile.role,
        errorCode: signedError?.name || null,
      })
      return { success: false, message: 'Nao foi possivel abrir o arquivo da nota fiscal.' }
    }

    return { success: true, url: data.signedUrl }
  } catch (error) {
    console.warn('[storage][nota-fiscal] Acesso ao arquivo negado.', {
      notaFiscalId,
      errorType: error instanceof Error ? error.name : 'unknown',
    })
    return { success: false, message: 'Arquivo indisponivel ou sem permissao de acesso.' }
  }
}
