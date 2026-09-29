'use server'

import {
  requireAuthenticated,
  requireNotaFiscalAccess,
  requireNotaFiscalViewAccess,
} from '@/lib/auth/authorization'
import { carregarMembershipConsultorAtiva } from '@/lib/consultor/membership.server'
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
    const auth = await requireAuthenticated()
    const membership = auth.profile.role === 'consultor'
      ? await carregarMembershipConsultorAtiva(auth)
      : null
    const context = membership?.papel === 'LEITOR'
      ? await requireNotaFiscalViewAccess(notaFiscalId, auth.supabase)
      : await requireNotaFiscalAccess(notaFiscalId, auth.supabase)
    const { data: nota, error } = await context.supabase
      .from('notas_fiscais')
      .select('id, arquivo_url, tipo_documento_fiscal, fiscal_proveniencia')
      .eq('id', notaFiscalId)
      .maybeSingle()

    if (error || !nota) {
      return { success: false, message: 'Nota fiscal nao encontrada.' }
    }
    let bucket: string = buckets.notasFiscais
    let path = nota.arquivo_url
    if (!path && nota.tipo_documento_fiscal === 'NFSE') {
      const { data: links, error: linksError } = await context.supabase.from('documento_requisito_instancias')
        .select('documento_id').eq('nota_fiscal_id', nota.id).eq('tipo_documento_codigo_snapshot', 'nf_danfe_pdf')
      const ids = (links ?? []).flatMap(link => link.documento_id ? [link.documento_id] : [])
      const provenance = nota.fiscal_proveniencia as { sha256?: string } | null
      if (!linksError && ids.length && provenance?.sha256) {
        const { data: original } = await context.supabase.from('documento_versoes')
          .select('bucket, path').in('documento_id', ids).eq('sha256', provenance.sha256)
          .order('numero_versao', { ascending: true }).limit(1).maybeSingle()
        if (original?.bucket === 'documentos-v2') { bucket = original.bucket; path = original.path }
      }
    }
    if (!path) {
      return { success: false, message: 'Esta nota fiscal nao possui arquivo original.' }
    }

    const { data, error: signedError } = await createAdminClient().storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

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
