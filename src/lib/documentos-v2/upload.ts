import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { requireNotaFiscalAccess } from '@/lib/auth/authorization'
import { registrarLog } from '@/lib/actions/auditoria'
import { gerarCaminhoDocumento, gerarCaminhoDocumentoLogistico, enviarObjetoDocumento, removerObjetoDocumento } from './storage'
import { DOCUMENTO_V2_BUCKET, extensaoArquivo, normalizarCodigoDocumentoCatalogo, validarArquivoContraTipo, mimeArquivo, nomeSeguro, sha256Arquivo, type TipoDocumentoV2 } from './tipos'
import { instanciarRequisitosDaNota, type ContextoDocumentoNotaFiscal } from './requisitos'
import { parseCteXml } from '@/lib/logistica/cte-parser'
import { mensagemValidacaoCte, validarCteContraNfes, type NfeParaValidacaoCte } from '@/lib/logistica/validacao-cte-nfe'
import { obterFundoAtivoAutorizado } from '@/lib/actions/fundo-ativo'

export interface UploadDocumentoNotaInput {
  notaFiscalId: string
  requisitoId: string
  arquivo: File
  contexto?: ContextoDocumentoNotaFiscal
}

export interface UploadDocumentoEntregaInput {
  notaFiscalId: string
  entregaId: string
  requisitoId: string
  arquivo: File
}

type NotaFiscalParaCteUpload = {
  id: string
  cedente_id: string
  cedente_fundo_id: string | null
  fundo_id: string | null
  chave_acesso: string | null
  data_emissao: string | null
  cnpj_emitente: string | null
  razao_social_emitente: string | null
  cnpj_destinatario: string | null
  razao_social_destinatario: string | null
  valor_bruto: number | null
  descricao_itens: string | null
}

async function carregarNotaParaValidacaoCte(input: {
  notaFiscalId: string
  client: AppSupabaseClient
  actorRole: string
}): Promise<NotaFiscalParaCteUpload> {
  const { data: nf, error } = await input.client
    .from('notas_fiscais')
    .select('id, cedente_id, cedente_fundo_id, fundo_id, chave_acesso, data_emissao, cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, descricao_itens')
    .eq('id', input.notaFiscalId)
    .maybeSingle()

  if (error) throw new Error(`Erro ao consultar NF-e para validar CT-e: ${error.message}`)
  if (!nf) throw new Error('NF-e nao encontrada para validar CT-e.')
  const typed = nf as NotaFiscalParaCteUpload
  if (!typed.fundo_id || !typed.cedente_fundo_id) throw new Error('NF-e sem contexto de fundo ou vinculo cedente-fundo.')

  if (input.actorRole === 'gestor') {
    const fundoAtivo = await obterFundoAtivoAutorizado()
    if (fundoAtivo.fundoId !== typed.fundo_id) throw new Error('NF-e fora do fundo ativo selecionado.')
  }

  return typed
}

export async function uploadDocumentoDaNota(
  input: UploadDocumentoNotaInput,
  client: AppSupabaseClient,
) {
  const context = await requireNotaFiscalAccess(input.notaFiscalId, client)
  if (!['cedente', 'gestor'].includes(context.profile.role)) throw new Error('Somente cedente ou gestor pode enviar documentos.')

  await instanciarRequisitosDaNota(input.notaFiscalId, client, input.contexto)
  const { data: requirement, error: requirementError } = await client
    .from('documento_requisito_instancias')
    .select('id, cedente_id, documento_id, documento_tipo_id, tipo_documento_codigo_snapshot')
    .eq('id', input.requisitoId)
    .eq('nota_fiscal_id', input.notaFiscalId)
    .maybeSingle()
  if (requirementError || !requirement) throw new Error('Requisito documental nao encontrado para esta NF.')
  let documentoTipoId = (requirement as { documento_tipo_id: string | null }).documento_tipo_id
  if (!documentoTipoId) {
    const codigoCatalogo = normalizarCodigoDocumentoCatalogo(requirement.tipo_documento_codigo_snapshot, extensaoArquivo(input.arquivo.name))
    const { data: resolvedType, error: resolvedTypeError } = await client
      .from('documento_tipos')
      .select('id')
      .eq('codigo', codigoCatalogo)
      .eq('ativo', true)
      .maybeSingle()

    if (resolvedTypeError) throw new Error(`Erro ao resolver tipo documental ${codigoCatalogo}: ${resolvedTypeError.message}`)
    if (!resolvedType) throw new Error(`Tipo documental ${codigoCatalogo} nao esta catalogado ou esta inativo.`)

    documentoTipoId = (resolvedType as { id: string }).id
    await client
      .from('documento_requisito_instancias')
      .update({ documento_tipo_id: documentoTipoId } as never)
      .eq('id', input.requisitoId)
      .eq('nota_fiscal_id', input.notaFiscalId)
  }

  const { data: tipo, error: tipoError } = await client
    .from('documento_tipos')
    .select('id, codigo, nome, mime_types_aceitos, extensoes_aceitas, tamanho_max_bytes, permite_multiplas_versoes, ativo')
    .eq('id', documentoTipoId)
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
      p_documento_tipo_id: documentoTipoId,
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
      dados_depois: {
        nota_fiscal_id: input.notaFiscalId,
        tipo: requirement.tipo_documento_codigo_snapshot,
        sha256_igual: result.sha256_igual,
        fundo_id: input.contexto?.fundoId ?? null,
        cedente_fundo_id: input.contexto?.cedenteFundoId ?? null,
        entidade_tipo: input.contexto?.entidadeTipo ?? 'nota_fiscal',
        entidade_id: input.contexto?.entidadeId ?? input.notaFiscalId,
      },
    }).catch(() => {})
    return { ...result, nome: input.arquivo.name }
  } catch (error) {
    if (uploaded) await removerObjetoDocumento(path)
    throw error
  }
}

export async function uploadDocumentoDaEntrega(
  input: UploadDocumentoEntregaInput,
  client: AppSupabaseClient,
) {
  const context = await requireNotaFiscalAccess(input.notaFiscalId, client)
  if (!['cedente', 'gestor'].includes(context.profile.role)) throw new Error('Somente cedente ou gestor pode enviar documentos.')

  const { data: entrega, error: entregaError } = await client
    .from('nota_fiscal_entregas')
    .select('id, nota_fiscal_id, status_entrega')
    .eq('id', input.entregaId)
    .eq('nota_fiscal_id', input.notaFiscalId)
    .maybeSingle()
  if (entregaError) throw new Error(`Erro ao validar entrega documental: ${entregaError.message}`)
  if (!entrega) throw new Error('Entrega documental nao encontrada para esta NF.')
  if (['nao_aplicavel', 'cancelada', 'devolvida', 'entregue'].includes(String(entrega.status_entrega))) {
    throw new Error('Entrega nao esta aberta para upload documental.')
  }

  const { data: requirement, error: requirementError } = await client
    .from('documento_requisito_instancias')
    .select('id, cedente_id, documento_id, documento_tipo_id, tipo_documento_codigo_snapshot')
    .eq('id', input.requisitoId)
    .eq('nota_fiscal_entrega_id', input.entregaId)
    .maybeSingle()
  if (requirementError) throw new Error(`Erro ao validar requisito documental: ${requirementError.message}`)
  if (!requirement) throw new Error('Requisito documental de entrega nao encontrado para esta NF.')

  let documentoTipoId = (requirement as { documento_tipo_id: string | null }).documento_tipo_id
  const codigoSnapshot = String(requirement.tipo_documento_codigo_snapshot)
  if (!documentoTipoId) {
    const codigoCatalogo = normalizarCodigoDocumentoCatalogo(codigoSnapshot, extensaoArquivo(input.arquivo.name))
    const { data: resolvedType, error: resolvedTypeError } = await client
      .from('documento_tipos')
      .select('id')
      .eq('codigo', codigoCatalogo)
      .eq('ativo', true)
      .maybeSingle()
    if (resolvedTypeError) throw new Error(`Erro ao resolver tipo documental ${codigoCatalogo}: ${resolvedTypeError.message}`)
    if (!resolvedType) throw new Error(`Tipo documental ${codigoCatalogo} nao esta catalogado ou esta inativo.`)

    documentoTipoId = (resolvedType as { id: string }).id
    await client
      .from('documento_requisito_instancias')
      .update({ documento_tipo_id: documentoTipoId } as never)
      .eq('id', input.requisitoId)
      .eq('nota_fiscal_entrega_id', input.entregaId)
  }

  const { data: tipo, error: tipoError } = await client
    .from('documento_tipos')
    .select('id, codigo, nome, mime_types_aceitos, extensoes_aceitas, tamanho_max_bytes, permite_multiplas_versoes, ativo')
    .eq('id', documentoTipoId)
    .eq('ativo', true)
    .single()
  if (tipoError || !tipo) throw new Error('Tipo documental inativo ou nao encontrado.')

  const tipoData = tipo as TipoDocumentoV2
  const validationError = validarArquivoContraTipo(input.arquivo, tipoData)
  if (validationError) throw new Error(validationError)

  const deveValidarCteXml = ['cte', 'cte_xml'].includes(codigoSnapshot) && String(tipoData.codigo) === 'cte_xml'
  let resultadoValidacaoCte: ReturnType<typeof validarCteContraNfes> | null = null
  let parsedCte: Awaited<ReturnType<typeof parseCteXml>> | null = null
  let nfParaCte: NotaFiscalParaCteUpload | null = null

  if (deveValidarCteXml) {
    parsedCte = await parseCteXml(input.arquivo)
    if (!parsedCte.valido) throw new Error(parsedCte.erros.join(' '))

    nfParaCte = await carregarNotaParaValidacaoCte({
      notaFiscalId: input.notaFiscalId,
      client,
      actorRole: context.profile.role,
    })

    if (parsedCte.chave_cte) {
      const { data: duplicado, error: duplicadoError } = await client
        .from('ctes')
        .select('id')
        .eq('chave_cte', parsedCte.chave_cte)
        .maybeSingle()
      if (duplicadoError) throw new Error(`Erro ao validar duplicidade do CT-e: ${duplicadoError.message}`)
      if (duplicado) throw new Error('Chave de CT-e ja cadastrada.')
    }

    resultadoValidacaoCte = validarCteContraNfes({
      cte: parsedCte,
      nfs: [{
        id: nfParaCte.id,
        chave_acesso: nfParaCte.chave_acesso,
        data_emissao: nfParaCte.data_emissao,
        cnpj_emitente: nfParaCte.cnpj_emitente,
        razao_social_emitente: nfParaCte.razao_social_emitente,
        cnpj_destinatario: nfParaCte.cnpj_destinatario,
        razao_social_destinatario: nfParaCte.razao_social_destinatario,
        valor_bruto: nfParaCte.valor_bruto,
        descricao_itens: nfParaCte.descricao_itens,
      } satisfies NfeParaValidacaoCte],
    })

    if (resultadoValidacaoCte.status === 'rejeitado') {
      throw new Error(mensagemValidacaoCte(resultadoValidacaoCte))
    }
  }

  const hash = await sha256Arquivo(input.arquivo)
  const mimeType = mimeArquivo(input.arquivo)
  const path = gerarCaminhoDocumentoLogistico({
    cedenteId: requirement.cedente_id,
    contextoTipo: deveValidarCteXml ? 'cte' : 'entrega',
    contextoId: deveValidarCteXml ? input.notaFiscalId : input.entregaId,
    tipoCodigo: codigoSnapshot,
    nomeOriginal: input.arquivo.name,
  })
  let uploaded = false
  try {
    await enviarObjetoDocumento(path, input.arquivo, mimeType)
    uploaded = true
    if (deveValidarCteXml && parsedCte) {
      const { data, error } = await client.rpc('registrar_cte_documento', {
        p_nota_fiscal_ids: [input.notaFiscalId],
        p_documento_tipo_codigo: 'cte_xml',
        p_nome_original: nomeSeguro(input.arquivo.name),
        p_mime_type: mimeType,
        p_tamanho_bytes: input.arquivo.size,
        p_sha256: hash,
        p_bucket: DOCUMENTO_V2_BUCKET,
        p_path: path,
        p_chave_cte: parsedCte.chave_cte,
        p_numero: parsedCte.numero,
        p_serie: parsedCte.serie,
        p_data_emissao: parsedCte.data_emissao,
        p_cnpj_transportadora: parsedCte.cnpj_transportadora,
        p_cnpj_remetente: parsedCte.cnpj_remetente,
        p_cnpj_destinatario: parsedCte.cnpj_destinatario,
        p_valor_frete: parsedCte.valor_frete,
        p_nivel_validacao: 'hibrido',
        p_dados_extraidos: { ...parsedCte, hash_sha256: hash, resultado_validacao: resultadoValidacaoCte },
      } as never)
      if (error) throw new Error(`Erro ao registrar CT-e validado: ${error.message}`)
      const result = data as Record<string, unknown>
      await registrarLog({
        tipo_evento: 'CTE_VALIDADO_ENVIADO',
        entidade_tipo: 'ctes',
        entidade_id: String(result.cte_id),
        dados_depois: {
          nota_fiscal_id: input.notaFiscalId,
          nota_fiscal_entrega_id: input.entregaId,
          requisito_id: input.requisitoId,
          status_validacao: resultadoValidacaoCte?.status,
          fundo_id: nfParaCte?.fundo_id ?? null,
          cedente_fundo_id: nfParaCte?.cedente_fundo_id ?? null,
        },
      }).catch(() => {})
      return { ...result, nome: input.arquivo.name, message: resultadoValidacaoCte ? mensagemValidacaoCte(resultadoValidacaoCte) : undefined }
    }

    const { data: latest } = requirement.documento_id
      ? await client.from('documento_versoes').select('id').eq('documento_id', requirement.documento_id).order('numero_versao', { ascending: false }).limit(1).maybeSingle()
      : { data: null }
    const { data, error } = await client.rpc('registrar_documento_entrega_upload', {
      p_nota_fiscal_entrega_id: input.entregaId,
      p_requisito_id: input.requisitoId,
      p_documento_tipo_id: documentoTipoId,
      p_nome_original: nomeSeguro(input.arquivo.name),
      p_mime_type: mimeType,
      p_tamanho_bytes: input.arquivo.size,
      p_sha256: hash,
      p_bucket: DOCUMENTO_V2_BUCKET,
      p_path: path,
      p_enviado_por: context.user.id,
      p_substitui_versao_id: latest?.id ?? null,
    } as never)
    if (error) throw new Error(`Erro ao registrar documento de entrega: ${error.message}`)
    const result = data as Record<string, unknown>
    await registrarLog({
      tipo_evento: 'DOCUMENTO_V2_ENTREGA_ENVIADO',
      entidade_tipo: 'documento_versoes',
      entidade_id: String(result.versao_id),
      dados_depois: {
        nota_fiscal_id: input.notaFiscalId,
        nota_fiscal_entrega_id: input.entregaId,
        requisito_id: input.requisitoId,
        tipo: codigoSnapshot,
        sha256_igual: result.sha256_igual,
        fundo_id: result.fundo_id ?? null,
        cedente_fundo_id: result.cedente_fundo_id ?? null,
      },
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
  contexto?: ContextoDocumentoNotaFiscal,
): Promise<boolean> {
  await instanciarRequisitosDaNota(notaFiscalId, client, contexto)
  const { data: requirement } = await client
    .from('documento_requisito_instancias')
    .select('id')
    .eq('nota_fiscal_id', notaFiscalId)
    .eq('tipo_documento_codigo_snapshot', tipoCodigo)
    .eq('status', 'pendente')
    .limit(1)
    .maybeSingle()
  if (!requirement) return false
  await uploadDocumentoDaNota({ notaFiscalId, requisitoId: requirement.id, arquivo, contexto }, client)
  return true
}
