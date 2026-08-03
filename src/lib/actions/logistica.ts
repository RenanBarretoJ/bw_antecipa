'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireGestor, requireNotaFiscalAccess, requireOperationAccess } from '@/lib/auth/authorization'
import { registrarLog } from './auditoria'
import { DOCUMENTO_V2_BUCKET, extensaoArquivo, mimeArquivo, nomeSeguro, sha256Arquivo } from '@/lib/documentos-v2/tipos'
import { enviarObjetoDocumento, gerarCaminhoDocumentoLogistico, gerarUrlDocumento, removerObjetoDocumento } from '@/lib/documentos-v2/storage'
import { parseCteXml } from '@/lib/logistica/cte-parser'
import { obterFundoAtivoAutorizado } from './fundo-ativo'
import { TIPOS_DOCUMENTAIS_CTE } from '@/lib/logistica/validacao-cte-config'
import { mensagemValidacaoCte, validarCteContraNfes, type NfeParaValidacaoCte } from '@/lib/logistica/validacao-cte-nfe'

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

type NotaFiscalCteRow = {
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

type EntregaCteRow = {
  id: string
  operacao_id: string
  nota_fiscal_id: string
  status_entrega: string
}

async function carregarContextoValidacaoCte(
  notaFiscalIds: string[],
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorRole: string,
) {
  for (const notaFiscalId of notaFiscalIds) {
    await requireNotaFiscalAccess(notaFiscalId, supabase)
  }

  const { data: nfs, error: nfsError } = await supabase
    .from('notas_fiscais')
    .select('id, cedente_id, cedente_fundo_id, fundo_id, chave_acesso, data_emissao, cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, descricao_itens')
    .in('id', notaFiscalIds)

  if (nfsError) throw new Error(`Erro ao consultar NF-e para validar CT-e: ${nfsError.message}`)
  const nfRows = (nfs || []) as NotaFiscalCteRow[]
  if (nfRows.length !== new Set(notaFiscalIds).size) throw new Error('Uma ou mais NF-e informadas nao foram encontradas.')

  const fundos = new Set(nfRows.map((nf) => nf.fundo_id).filter(Boolean))
  const cedentes = new Set(nfRows.map((nf) => nf.cedente_id).filter(Boolean))
  const vinculos = new Set(nfRows.map((nf) => nf.cedente_fundo_id).filter(Boolean))
  if (cedentes.size !== 1 || fundos.size !== 1 || vinculos.size !== 1) {
    throw new Error('As NF-e do CT-e precisam pertencer ao mesmo cedente, fundo e vinculo cedente-fundo.')
  }

  const fundoId = [...fundos][0]
  const cedenteFundoId = [...vinculos][0]
  if (!fundoId || !cedenteFundoId) throw new Error('NF-e sem contexto de fundo ou vinculo cedente-fundo.')

  if (actorRole === 'gestor') {
    const fundoAtivo = await obterFundoAtivoAutorizado()
    if (fundoAtivo.fundoId !== fundoId) throw new Error('NF-e fora do fundo ativo selecionado.')
  }

  const { data: entregas, error: entregasError } = await supabase
    .from('nota_fiscal_entregas')
    .select('id, operacao_id, nota_fiscal_id, status_entrega')
    .in('nota_fiscal_id', notaFiscalIds)
    .not('status_entrega', 'in', '(nao_aplicavel,cancelada,devolvida)')

  if (entregasError) throw new Error(`Erro ao consultar acompanhamento logistico: ${entregasError.message}`)
  const entregaRows = (entregas || []) as EntregaCteRow[]
  if (entregaRows.length === 0) throw new Error('A NF-e nao possui acompanhamento logistico ativo para receber CT-e.')

  const entregaIds = entregaRows.map((entrega) => entrega.id)
  const { data: requisitos, error: requisitosError } = await supabase
    .from('documento_requisito_instancias')
    .select('id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_id, operacao_id, nota_fiscal_entrega_id, cedente_id, status')
    .in('nota_fiscal_entrega_id', entregaIds)
    .in('tipo_documento_codigo_snapshot', [...TIPOS_DOCUMENTAIS_CTE])
    .not('status', 'in', '(cancelado,dispensado)')

  if (requisitosError) throw new Error(`Erro ao validar requisito documental CT-e: ${requisitosError.message}`)
  if (!requisitos?.length) {
    throw new Error('CT-e nao esta configurado como requisito documental para esta NF/operação.')
  }

  for (const nfId of notaFiscalIds) {
    const temRequisito = requisitos.some((req) => String((req as { nota_fiscal_entrega_id: string }).nota_fiscal_entrega_id) && entregaRows.some((entrega) => entrega.nota_fiscal_id === nfId && entrega.id === String((req as { nota_fiscal_entrega_id: string }).nota_fiscal_entrega_id)))
    if (!temRequisito) throw new Error('Requisito CT-e nao pertence a uma das NF-e informadas.')
  }

  return {
    nfs: nfRows,
    entregas: entregaRows,
    fundoId,
    cedenteFundoId,
  }
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

  let resultadoValidacaoCte: ReturnType<typeof validarCteContraNfes> | null = null
  if (tipoCodigo === 'cte_xml' && parsed) {
    try {
      const contextoValidacao = await carregarContextoValidacaoCte(notaFiscalIds, supabase, context.profile.role)
      const { data: duplicado, error: duplicadoError } = parsed.chave_cte
        ? await supabase.from('ctes').select('id').eq('chave_cte', parsed.chave_cte).maybeSingle()
        : { data: null, error: null }
      if (duplicadoError) throw new Error(`Erro ao validar duplicidade do CT-e: ${duplicadoError.message}`)
      if (duplicado) return { success: false, message: 'Chave de CT-e ja cadastrada.' }

      resultadoValidacaoCte = validarCteContraNfes({
        cte: parsed,
        nfs: contextoValidacao.nfs.map((nf): NfeParaValidacaoCte => ({
          id: nf.id,
          chave_acesso: nf.chave_acesso,
          data_emissao: nf.data_emissao,
          cnpj_emitente: nf.cnpj_emitente,
          razao_social_emitente: nf.razao_social_emitente,
          cnpj_destinatario: nf.cnpj_destinatario,
          razao_social_destinatario: nf.razao_social_destinatario,
          valor_bruto: nf.valor_bruto,
          descricao_itens: nf.descricao_itens,
        })),
      })
      if (resultadoValidacaoCte.status === 'rejeitado') {
        return { success: false, message: mensagemValidacaoCte(resultadoValidacaoCte), data: { resultado_validacao: resultadoValidacaoCte } }
      }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Nao foi possivel validar o CT-e contra a NF-e.' }
    }
  }

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
      p_nivel_validacao: tipoCodigo === 'cte_xml' ? 'hibrido' : 'manual',
      p_dados_extraidos: parsed ? { ...parsed, hash_sha256: hash, resultado_validacao: resultadoValidacaoCte } : {},
    })
    if (error) throw new Error(error.message)
    const result = data as Record<string, unknown>
    await registrarLog({ tipo_evento: 'CTE_ENVIADO', entidade_tipo: 'ctes', entidade_id: String(result.cte_id), dados_depois: { nota_fiscal_ids: notaFiscalIds, tipo: tipoCodigo } }).catch(() => {})
    return { success: true, message: resultadoValidacaoCte ? mensagemValidacaoCte(resultadoValidacaoCte) : 'CT-e enviado para analise.', data: result }
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
    .select('id, nota_fiscal_id, status_entrega, cessao_efetivada_em, data_limite_cte, data_limite_canhoto, data_entrega, entrega_confirmada_em, motivo_pendencia, created_at, updated_at')
    .eq('operacao_id', operacaoId)
    .order('created_at', { ascending: true })
  return data || []
}
