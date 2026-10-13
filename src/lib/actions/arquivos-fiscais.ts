'use server'

import { requireNotaFiscalAccess } from '@/lib/auth/authorization'
import { validarNivelAutenticacao } from '@/lib/auth/mfa'
import { createAdminClient } from '@/lib/supabase/server'
import { obterUrlArquivoNotaFiscal } from '@/lib/actions/arquivo-nota-fiscal'
import { baixarVersaoDocumento } from '@/lib/actions/documento-v2'
import { metadadosArquivoFiscal, type ArquivoFiscalResumo } from '@/lib/notas-fiscais/arquivo-fiscal'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DENIED = 'Arquivo indisponível ou sem permissão de acesso.'
type ListaArquivos = { success: true; arquivos: ArquivoFiscalResumo[] } | { success: false; message: string }
type AcessoArquivo = { success: true; url: string; arquivo: ArquivoFiscalResumo } | { success: false; message: string }

/** Metadados mínimos; nenhuma URL, bucket ou caminho é enviado na listagem. */
export async function listarArquivosOriginaisNotaFiscal(notaFiscalId: string): Promise<ListaArquivos> {
  if (!UUID.test(notaFiscalId)) return { success: false, message: DENIED }
  try {
    const context = await requireNotaFiscalAccess(notaFiscalId)
    if (!await validarNivelAutenticacao(context.supabase)) return { success: false, message: DENIED }
    const { data: nota, error } = await context.supabase.from('notas_fiscais')
      .select('id, arquivo_url, tipo_documento_fiscal, fiscal_reservation_id')
      .eq('id', notaFiscalId).maybeSingle()
    if (error || !nota) return { success: false, message: DENIED }

    // Legado continua usando a action existente, inclusive o fallback de NFS-e.
    if (!nota.fiscal_reservation_id) {
      const nome = nota.arquivo_url?.split('/').pop()
        || (nota.tipo_documento_fiscal === 'NFSE' ? 'NFS-e.pdf' : 'Arquivo original')
      return { success: true, arquivos: nota.arquivo_url || nota.tipo_documento_fiscal === 'NFSE'
        ? [{ id: 'original', ...metadadosArquivoFiscal(nome, null), tamanhoBytes: null, numeroVersao: null }]
        : [] }
    }

    // O journal resolve o original somente após a autorização pela NF.
    const { data: original, error: journalError } = await createAdminClient()
      .rpc('fiscal_intake_get_original', { p_nf_id: nota.id })
    if (journalError || !original || typeof original !== 'object' || Array.isArray(original)
      || !('bucket' in original) || !('path' in original)
      || (original.bucket !== 'notas-fiscais' && original.bucket !== 'documentos-v2')
      || typeof original.path !== 'string' || !original.path) return { success: false, message: DENIED }

    const { data: links, error: linksError } = await context.supabase.from('documento_vinculos')
      .select('documento_id').eq('nota_fiscal_id', nota.id)
    if (linksError) return { success: false, message: DENIED }
    const ids = [...new Set((links ?? []).map(link => link.documento_id))]
    const { data: versions, error: versionsError } = ids.length
      ? await context.supabase.from('documento_versoes')
        .select('id, documento_id, bucket, path, nome_original, mime_type, tamanho_bytes, numero_versao')
        .in('documento_id', ids).eq('fiscal_reservation_id', nota.fiscal_reservation_id)
        .order('numero_versao', { ascending: true })
      : { data: [], error: null }
    if (versionsError) return { success: false, message: DENIED }
    const first = (versions ?? []).find(v => v.bucket === original.bucket && v.path === original.path)
    const arquivos: ArquivoFiscalResumo[] = [{ id: 'original',
      ...metadadosArquivoFiscal(first?.nome_original || original.path.split('/').pop() || 'Arquivo original', first?.mime_type || null),
      tamanhoBytes: first?.tamanho_bytes ?? null, numeroVersao: first?.numero_versao ?? null }]

    // Apenas versões fiscais da mesma reserva e vinculadas à mesma NF.
    // Não promover uma versão documental posterior a "original canônico".
    if (nota.tipo_documento_fiscal === 'NFE') {
      for (const version of versions ?? []) {
        if (version.bucket !== 'documentos-v2' || version.mime_type !== 'application/pdf'
          || (version.bucket === original.bucket && version.path === original.path)) continue
        arquivos.push({ id: version.id, ...metadadosArquivoFiscal(version.nome_original, version.mime_type, true),
          tamanhoBytes: version.tamanho_bytes, numeroVersao: version.numero_versao })
      }
    }
    return { success: true, arquivos }
  } catch {
    return { success: false, message: DENIED }
  }
}

/** Reautoriza a cada clique; IDs arbitrários não escolhem bucket ou caminho. */
export async function obterAcessoArquivoFiscal(notaFiscalId: string, arquivoId: string): Promise<AcessoArquivo> {
  if (arquivoId !== 'original' && !UUID.test(arquivoId)) return { success: false, message: DENIED }
  try {
    const list = await listarArquivosOriginaisNotaFiscal(notaFiscalId)
    if (!list.success) return list
    const arquivo = list.arquivos.find(item => item.id === arquivoId)
    if (!arquivo) return { success: false, message: DENIED }
    const signed = arquivoId === 'original'
      ? await obterUrlArquivoNotaFiscal(notaFiscalId)
      : await baixarVersaoDocumento(arquivoId)
    if (!signed.success || !signed.url) return { success: false, message: DENIED }
    return { success: true, url: signed.url, arquivo }
  } catch {
    return { success: false, message: DENIED }
  }
}
