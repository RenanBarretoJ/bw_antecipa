'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireGestor, requireNotaFiscalAccess, requireOperationAccess } from '@/lib/auth/authorization'
import { registrarLog } from './auditoria'
import { DOCUMENTO_V2_BUCKET, extensaoArquivo, mimeArquivo, nomeSeguro, sha256Arquivo } from '@/lib/documentos-v2/tipos'
import { enviarObjetoDocumento, gerarCaminhoDocumentoLogistico, gerarUrlDocumento, removerObjetoDocumento } from '@/lib/documentos-v2/storage'
import { parseCteXml } from '@/lib/logistica/cte-parser'

export type LogisticaActionState = { success?: boolean; message?: string; data?: Record<string, unknown>; url?: string; nome?: string } | undefined

function validarTipoArquivo(file: File, tipo: 'cte_xml' | 'cte_pdf_dacte' | 'canhoto'): string | null {
  const mime = mimeArquivo(file)
  const ext = extensaoArquivo(file.name)
  if (tipo === 'cte_xml' && !['application/xml', 'text/xml'].includes(mime) && ext !== 'xml') return 'CT-e XML deve ser um arquivo XML.'
  if (tipo === 'cte_pdf_dacte' && mime !== 'application/pdf' && ext !== 'pdf') return 'CT-e PDF/DACTE deve ser um PDF.'
  if (tipo === 'canhoto' && !['application/pdf', 'image/jpeg', 'image/png'].includes(mime) && !['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) return 'Canhoto deve ser PDF, JPG ou PNG.'
  if (file.size <= 0) return 'O arquivo esta vazio.'
  if (file.size > 20 * 1024 * 1024) return 'O arquivo excede o limite de 20MB.'
  return null
}

function normalizarCnpj(value: FormDataEntryValue | null): string | null {
  const digits = String(value || '').replace(/\D/g, '')
  return digits || null
}

export async function enviarCte(formData: FormData): Promise<LogisticaActionState> {
  const notaFiscalIds = String(formData.get('notaFiscalIds') || '').split(',').map((id) => id.trim()).filter(Boolean)
  const arquivo = formData.get('arquivo')
  if (notaFiscalIds.length === 0 || !(arquivo instanceof File)) return { success: false, message: 'NFs e arquivo sao obrigatorios.' }

  const supabase = await createClient()
  const context = await requireNotaFiscalAccess(notaFiscalIds[0], supabase)
  const tipoCodigo = extensaoArquivo(arquivo.name) === 'xml' ? 'cte_xml' : 'cte_pdf_dacte'
  const validationError = validarTipoArquivo(arquivo, tipoCodigo)
  if (validationError) return { success: false, message: validationError }

  const parsed = tipoCodigo === 'cte_xml' ? await parseCteXml(arquivo) : null
  if (parsed && !parsed.valido) return { success: false, message: parsed.erros.join(' ') }

  const hash = await sha256Arquivo(arquivo)
  const mimeType = mimeArquivo(arquivo)
  const path = gerarCaminhoDocumentoLogistico({
    cedenteId: context.notaFiscal.cedente_id,
    contextoTipo: 'cte',
    contextoId: notaFiscalIds[0],
    tipoCodigo,
    nomeOriginal: arquivo.name,
  })

  let uploaded = false
  try {
    await enviarObjetoDocumento(path, arquivo, mimeType)
    uploaded = true
    const { data, error } = await supabase.rpc('registrar_cte_documento', {
      p_nota_fiscal_ids: notaFiscalIds,
      p_documento_tipo_codigo: tipoCodigo,
      p_nome_original: nomeSeguro(arquivo.name),
      p_mime_type: mimeType,
      p_tamanho_bytes: arquivo.size,
      p_sha256: hash,
      p_bucket: DOCUMENTO_V2_BUCKET,
      p_path: path,
      p_chave_cte: parsed?.chave_cte || String(formData.get('chaveCte') || '').replace(/\D/g, '') || null,
      p_numero: parsed?.numero || String(formData.get('numero') || '') || null,
      p_serie: parsed?.serie || String(formData.get('serie') || '') || null,
      p_data_emissao: parsed?.data_emissao || String(formData.get('dataEmissao') || '') || null,
      p_cnpj_transportadora: parsed?.cnpj_transportadora || normalizarCnpj(formData.get('cnpjTransportadora')),
      p_cnpj_remetente: parsed?.cnpj_remetente || normalizarCnpj(formData.get('cnpjRemetente')),
      p_cnpj_destinatario: parsed?.cnpj_destinatario || normalizarCnpj(formData.get('cnpjDestinatario')),
      p_valor_frete: parsed?.valor_frete ?? (Number(String(formData.get('valorFrete') || '0').replace(',', '.')) || null),
      p_nivel_validacao: tipoCodigo === 'cte_xml' ? 'estrutural' : 'manual',
      p_dados_extraidos: parsed ? { ...parsed } : {},
    })
    if (error) throw new Error(error.message)
    const result = data as Record<string, unknown>
    await registrarLog({ tipo_evento: 'CTE_ENVIADO', entidade_tipo: 'ctes', entidade_id: String(result.cte_id), dados_depois: { nota_fiscal_ids: notaFiscalIds, tipo: tipoCodigo } }).catch(() => {})
    return { success: true, message: 'CT-e enviado para analise.', data: result }
  } catch (error) {
    if (uploaded) await removerObjetoDocumento(path)
    return { success: false, message: error instanceof Error ? error.message : 'Nao foi possivel enviar o CT-e.' }
  }
}

export async function enviarCanhoto(formData: FormData): Promise<LogisticaActionState> {
  const entregaId = String(formData.get('entregaId') || '')
  const arquivo = formData.get('arquivo')
  if (!entregaId || !(arquivo instanceof File)) return { success: false, message: 'Entrega e arquivo sao obrigatorios.' }
  const validationError = validarTipoArquivo(arquivo, 'canhoto')
  if (validationError) return { success: false, message: validationError }

  const supabase = await createClient()
  const { data: entrega } = await supabase
    .from('nota_fiscal_entregas')
    .select('id, nota_fiscal_id, operacoes(cedente_id)')
    .eq('id', entregaId)
    .maybeSingle()
  if (!entrega?.nota_fiscal_id) return { success: false, message: 'Entrega nao encontrada.' }
  const context = await requireNotaFiscalAccess(entrega.nota_fiscal_id, supabase)

  const hash = await sha256Arquivo(arquivo)
  const mimeType = mimeArquivo(arquivo)
  const path = gerarCaminhoDocumentoLogistico({
    cedenteId: context.notaFiscal.cedente_id,
    contextoTipo: 'entrega',
    contextoId: entregaId,
    tipoCodigo: 'canhoto',
    nomeOriginal: arquivo.name,
  })

  let uploaded = false
  try {
    await enviarObjetoDocumento(path, arquivo, mimeType)
    uploaded = true
    const { data, error } = await supabase.rpc('registrar_canhoto_documento', {
      p_nota_fiscal_entrega_id: entregaId,
      p_nome_original: nomeSeguro(arquivo.name),
      p_mime_type: mimeType,
      p_tamanho_bytes: arquivo.size,
      p_sha256: hash,
      p_bucket: DOCUMENTO_V2_BUCKET,
      p_path: path,
      p_data_assinatura: String(formData.get('dataAssinatura') || '') || null,
      p_nome_recebedor: String(formData.get('nomeRecebedor') || '') || null,
      p_documento_recebedor: normalizarCnpj(formData.get('documentoRecebedor')),
      p_possui_assinatura: formData.get('possuiAssinatura') === 'on' || formData.get('possuiAssinatura') === 'true',
      p_possui_ressalva: formData.get('possuiRessalva') === 'on' || formData.get('possuiRessalva') === 'true',
      p_descricao_ressalva: String(formData.get('descricaoRessalva') || '') || null,
    })
    if (error) throw new Error(error.message)
    const result = data as Record<string, unknown>
    await registrarLog({ tipo_evento: 'CANHOTO_ENVIADO', entidade_tipo: 'canhotos', entidade_id: String(result.canhoto_id), dados_depois: { entrega_id: entregaId } }).catch(() => {})
    return { success: true, message: 'Canhoto enviado para analise.', data: result }
  } catch (error) {
    if (uploaded) await removerObjetoDocumento(path)
    return { success: false, message: error instanceof Error ? error.message : 'Nao foi possivel enviar o canhoto.' }
  }
}

export async function analisarCte(cteId: string, versaoId: string, resultado: 'aprovado' | 'rejeitado', motivo?: string): Promise<LogisticaActionState> {
  const context = await requireGestor()
  const { data, error } = await context.supabase.rpc('analisar_cte_documento', {
    p_cte_id: cteId,
    p_documento_versao_id: versaoId,
    p_resultado: resultado,
    p_motivo: motivo || null,
  })
  if (error) return { success: false, message: error.message }
  await registrarLog({ tipo_evento: resultado === 'aprovado' ? 'CTE_APROVADO' : 'CTE_REJEITADO', entidade_tipo: 'ctes', entidade_id: cteId, dados_depois: { resultado, motivo } }).catch(() => {})
  return { success: true, message: resultado === 'aprovado' ? 'CT-e aprovado.' : 'CT-e rejeitado.', data: data as Record<string, unknown> }
}

export async function analisarCanhoto(canhotoId: string, versaoId: string, resultado: 'aprovado' | 'rejeitado', motivo?: string): Promise<LogisticaActionState> {
  const context = await requireGestor()
  const { data, error } = await context.supabase.rpc('analisar_canhoto_documento', {
    p_canhoto_id: canhotoId,
    p_documento_versao_id: versaoId,
    p_resultado: resultado,
    p_motivo: motivo || null,
  })
  if (error) return { success: false, message: error.message }
  await registrarLog({ tipo_evento: resultado === 'aprovado' ? 'CANHOTO_APROVADO' : 'CANHOTO_REJEITADO', entidade_tipo: 'canhotos', entidade_id: canhotoId, dados_depois: { resultado, motivo } }).catch(() => {})
  return { success: true, message: resultado === 'aprovado' ? 'Canhoto aprovado.' : 'Canhoto rejeitado.', data: data as Record<string, unknown> }
}

export async function registrarPendenciaEntrega(entregaId: string, motivo: string): Promise<LogisticaActionState> {
  await requireGestor()
  const supabase = await createClient()
  if (!motivo.trim()) return { success: false, message: 'Motivo e obrigatorio.' }
  const { error } = await supabase.from('nota_fiscal_entregas').update({ status_entrega: 'entrega_com_pendencia', motivo_pendencia: motivo } as never).eq('id', entregaId)
  if (error) return { success: false, message: error.message }
  await registrarLog({ tipo_evento: 'ENTREGA_COM_PENDENCIA', entidade_tipo: 'nota_fiscal_entregas', entidade_id: entregaId, dados_depois: { motivo } }).catch(() => {})
  return { success: true, message: 'Pendencia registrada.' }
}

export async function baixarVersaoLogistica(versaoId: string): Promise<LogisticaActionState> {
  const supabase = await createClient()
  const { data: version } = await supabase.from('documento_versoes').select('id, documento_id, path, nome_original').eq('id', versaoId).maybeSingle()
  if (!version) return { success: false, message: 'Versao documental nao encontrada.' }
  const { data: vinculo } = await supabase
    .from('documento_vinculos')
    .select('nota_fiscal_id, nota_fiscal_entrega_id, cte_id')
    .eq('documento_id', version.documento_id)
    .maybeSingle()
  let acessoValidado = false
  if (vinculo?.nota_fiscal_id) {
    await requireNotaFiscalAccess(vinculo.nota_fiscal_id, supabase)
    acessoValidado = true
  }
  if (vinculo?.nota_fiscal_entrega_id) {
    const { data: entrega } = await supabase.from('nota_fiscal_entregas').select('nota_fiscal_id').eq('id', vinculo.nota_fiscal_entrega_id).maybeSingle()
    if (entrega?.nota_fiscal_id) {
      await requireNotaFiscalAccess(entrega.nota_fiscal_id, supabase)
      acessoValidado = true
    }
  }
  if (vinculo?.cte_id) {
    const { data: cteNf } = await supabase.from('cte_notas_fiscais').select('nota_fiscal_id').eq('cte_id', vinculo.cte_id).limit(1).maybeSingle()
    if (cteNf?.nota_fiscal_id) {
      await requireNotaFiscalAccess(cteNf.nota_fiscal_id, supabase)
      acessoValidado = true
    }
  }
  if (!acessoValidado) return { success: false, message: 'Documento logistico sem vinculo autorizado.' }
  return { success: true, url: await gerarUrlDocumento(version.path), nome: version.nome_original }
}

export async function processarPrazosEntrega(dataReferencia?: string): Promise<LogisticaActionState> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('processar_prazos_entrega', { p_data: dataReferencia || null })
  if (error) return { success: false, message: error.message }
  return { success: true, message: 'Prazos processados.', data: data as Record<string, unknown> }
}

export async function carregarResumoEntregaPorOperacao(operacaoId: string) {
  await requireOperationAccess(operacaoId)
  const supabase = await createClient()
  const { data } = await supabase
    .from('nota_fiscal_entregas')
    .select('*, notas_fiscais(numero_nf, valor_bruto), canhotos(*), eventos_entrega(*), cte_notas_fiscais(ctes(*))')
    .eq('operacao_id', operacaoId)
    .order('created_at', { ascending: true })
  return data || []
}
