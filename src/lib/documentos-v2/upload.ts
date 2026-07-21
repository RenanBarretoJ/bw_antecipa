import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { requireNotaFiscalAccess } from '@/lib/auth/authorization'
import { registrarLog } from '@/lib/actions/auditoria'
import { gerarCaminhoDocumento, enviarObjetoDocumento, removerObjetoDocumento } from './storage'
import { DOCUMENTO_V2_BUCKET, validarArquivoContraTipo, mimeArquivo, nomeSeguro, sha256Arquivo, type TipoDocumentoV2 } from './tipos'
import { instanciarRequisitosDaNota } from './requisitos'

export interface UploadDocumentoNotaInput {
  notaFiscalId: string
  requisitoId: string
  arquivo: File
}

export async function uploadDocumentoDaNota(
  input: UploadDocumentoNotaInput,
  client: AppSupabaseClient,
) {
  const context = await requireNotaFiscalAccess(input.notaFiscalId, client)
  if (!['cedente', 'gestor'].includes(context.profile.role)) throw new Error('Somente cedente ou gestor pode enviar documentos.')

  await instanciarRequisitosDaNota(input.notaFiscalId, client)
  const { data: requirement, error: requirementError } = await client
    .from('documento_requisito_instancias')
    .select('id, cedente_id, documento_id, documento_tipo_id, tipo_documento_codigo_snapshot')
    .eq('id', input.requisitoId)
    .eq('nota_fiscal_id', input.notaFiscalId)
    .maybeSingle()
  if (requirementError || !requirement) throw new Error('Requisito documental nao encontrado para esta NF.')
  if (!requirement.documento_tipo_id) throw new Error('Este requisito ainda nao possui tipo de documento catalogado.')

  const { data: tipo, error: tipoError } = await client
    .from('documento_tipos')
    .select('id, codigo, nome, mime_types_aceitos, extensoes_aceitas, tamanho_max_bytes, permite_multiplas_versoes, ativo')
    .eq('id', requirement.documento_tipo_id)
    .eq('ativo', true)
    .single()
  if (tipoError || !tipo) throw new Error('Tipo documental inativo ou nao encontrado.')
  const tipoData = tipo as TipoDocumentoV2
  const validationError = validarArquivoContraTipo(input.arquivo, tipoData)
  if (validationError) throw new Error(validationError)

  const hash = await sha256Arquivo(input.arquivo)
  const mimeType = mimeArquivo(input.arquivo)
  const path = gerarCaminhoDocumento({
    cedenteId: requirement.cedente_id,
    notaFiscalId: input.notaFiscalId,
    tipoCodigo: requirement.tipo_documento_codigo_snapshot,
    nomeOriginal: input.arquivo.name,
  })
  let uploaded = false
  try {
    await enviarObjetoDocumento(path, input.arquivo, mimeType)
    uploaded = true
    const { data: latest } = requirement.documento_id
      ? await client.from('documento_versoes').select('id').eq('documento_id', requirement.documento_id).order('numero_versao', { ascending: false }).limit(1).maybeSingle()
      : { data: null }
    const { data, error } = await client.rpc('registrar_documento_upload', {
      p_nota_fiscal_id: input.notaFiscalId,
      p_requisito_id: input.requisitoId,
      p_documento_tipo_id: requirement.documento_tipo_id,
      p_nome_original: nomeSeguro(input.arquivo.name),
      p_mime_type: mimeType,
      p_tamanho_bytes: input.arquivo.size,
      p_sha256: hash,
      p_bucket: DOCUMENTO_V2_BUCKET,
      p_path: path,
      p_enviado_por: context.user.id,
      p_substitui_versao_id: latest?.id ?? null,
    })
    if (error) throw new Error(`Erro ao registrar versao documental: ${error.message}`)
    const result = data as Record<string, unknown>
    await registrarLog({
      tipo_evento: 'DOCUMENTO_V2_ENVIADO',
      entidade_tipo: 'documento_versoes',
      entidade_id: String(result.versao_id),
      dados_depois: { nota_fiscal_id: input.notaFiscalId, tipo: requirement.tipo_documento_codigo_snapshot, sha256_igual: result.sha256_igual },
    }).catch(() => {})
    return { ...result, nome: input.arquivo.name }
  } catch (error) {
    if (uploaded) await removerObjetoDocumento(path)
    throw error
  }
}

export async function uploadDocumentoSeRequerido(
  notaFiscalId: string,
  tipoCodigo: string,
  arquivo: File,
  client: AppSupabaseClient,
): Promise<boolean> {
  await instanciarRequisitosDaNota(notaFiscalId, client)
  const { data: requirement } = await client
    .from('documento_requisito_instancias')
    .select('id')
    .eq('nota_fiscal_id', notaFiscalId)
    .eq('tipo_documento_codigo_snapshot', tipoCodigo)
    .eq('status', 'pendente')
    .limit(1)
    .maybeSingle()
  if (!requirement) return false
  await uploadDocumentoDaNota({ notaFiscalId, requisitoId: requirement.id, arquivo }, client)
  return true
}
