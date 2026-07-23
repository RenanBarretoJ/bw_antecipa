'use server'

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireAuthenticated, requireGestor as requireGestorBase } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { notaFiscalSchema, type NotaFiscalFormData } from '@/lib/validations/nf'
import { parseNFeXML } from '@/lib/nf-parser'
import { extractDanfeFromPdf, type NfPdfExtracted } from '@/lib/pdf-nf-parser'
import { registrarLog } from './auditoria'
import { notificarGestores, notificarCedente } from './notificacao'
import { buckets } from '@/lib/storage'
import { uploadDocumentoSeRequerido } from '@/lib/documentos-v2/upload'
import { CedenteFundoError, resolverCedenteFundoAtivo } from '@/lib/fundos/cedente-fundo'
import { decidirAcaoDuplicidadeNotaFiscal, mensagemDuplicidadeNotaFiscal } from '@/lib/notas-fiscais/upload-context'

export type NfActionState = {
  success?: boolean
  errors?: Record<string, string[]>
  message?: string
  ids?: string[]
  rascunhos?: string[]
  data?: {
    id: string
    parsed?: Record<string, unknown>
  }
} | undefined

async function requireGestor() {
  const context = await requireGestorBase()
  await exigirSessaoElevada(context)
  return context
}

type CedenteUploadContext = {
  userId: string
  cedente: { id: string; cnpj: string; razao_social: string; status: string }
  cedenteFundoId: string
  fundoId: string
}

function logUploadNf(
  etapa: string,
  context: Partial<CedenteUploadContext> & { chaveAcesso?: string | null; erro?: unknown; notaFiscalId?: string | null },
) {
  console.error('[uploadNFs][cedente]', {
    etapa,
    user_id: context.userId ?? null,
    cedente_id: context.cedente?.id ?? null,
    cedente_fundo_id: context.cedenteFundoId ?? null,
    fundo_id: context.fundoId ?? null,
    chave_acesso: context.chaveAcesso ?? null,
    nota_fiscal_id: context.notaFiscalId ?? null,
    erro: context.erro instanceof Error ? context.erro.message : context.erro ?? null,
  })
}

async function getCedenteComUsuario(supabaseParam?: Awaited<ReturnType<typeof createClient>>) {
  const supabase = supabaseParam ?? await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(`Erro ao identificar usuario autenticado: ${userError.message}`)
  if (!user) return null

  const { data: cedente, error: cedenteError } = await supabase
    .from('cedentes')
    .select('id, cnpj, razao_social, status')
    .maybeSingle()

  if (cedenteError) throw new Error(`Erro ao consultar cedente do usuario: ${cedenteError.message}`)
  if (!cedente) return null
  return { userId: user.id, cedente: cedente as { id: string; cnpj: string; razao_social: string; status: string } }
}

async function getCedenteDoUsuario(supabaseParam?: Awaited<ReturnType<typeof createClient>>) {
  const result = await getCedenteComUsuario(supabaseParam)
  return result?.cedente ?? null
}

async function resolverContextoUploadCedente(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<CedenteUploadContext | { error: string }> {
  let partialContext: Partial<CedenteUploadContext> = {}
  try {
    const base = await getCedenteComUsuario(supabase)
    if (!base) return { error: 'Cadastro de cedente nao encontrado.' }
    partialContext = { userId: base.userId, cedente: base.cedente }
    if (base.cedente.status !== 'ativo') return { error: 'Seu cadastro precisa estar ativo para enviar NFs.' }

    const resolved = await resolverCedenteFundoAtivo(base.cedente.id, supabase)
    partialContext = {
      ...partialContext,
      cedenteFundoId: resolved.cedenteFundo?.id,
      fundoId: resolved.cedenteFundo?.fundo_id ?? resolved.fundo?.id,
    }
    if (resolved.source !== 'bridge' || !resolved.cedenteFundo || !resolved.fundo) {
      return { error: 'Nenhum vinculo cedente-fundo ativo foi encontrado para este cedente.' }
    }
    if (resolved.cedenteFundo.status !== 'ativo') {
      return { error: 'O vinculo cedente-fundo deste cedente nao esta ativo.' }
    }
    if (resolved.fundo.ativo !== true) {
      return { error: 'O fundo vinculado ao cedente esta inativo.' }
    }

    return {
      userId: base.userId,
      cedente: base.cedente,
      cedenteFundoId: resolved.cedenteFundo.id,
      fundoId: resolved.fundo.id,
    }
  } catch (error) {
    logUploadNf('resolver_contexto_erro', { ...partialContext, erro: error })
    if (error instanceof CedenteFundoError) {
      if (error.code === 'MULTIPLOS_VINCULOS_ATIVOS') {
        return { error: 'Ha mais de um vinculo ativo para este cedente; selecione o fundo antes de enviar NFs.' }
      }
      if (error.code === 'VINCULO_NOT_FOUND') return { error: error.message }
      if (error.code === 'FUNDO_NOT_FOUND') return { error: 'Fundo vinculado ao cedente nao encontrado.' }
      if (error.code === 'FUNDO_INATIVO') return { error: 'O fundo vinculado ao cedente esta inativo.' }
    }
    return { error: error instanceof Error ? error.message : 'Nao foi possivel resolver o fundo do cedente.' }
  }
}

type ArquivoResult =
  | { ok: true; id: string; isRascunho: boolean }
  | { ok: false; error: string }

type NfExistente = {
  id: string
  cedente_id: string
  cedente_fundo_id: string | null
  fundo_id: string | null
  arquivo_url: string | null
  status: string
}

async function notaFiscalPossuiDocumentoXml(
  supabase: Awaited<ReturnType<typeof createClient>>,
  notaFiscalId: string,
): Promise<boolean> {
  const { data: requisitos, error } = await supabase
    .from('documento_requisito_instancias')
    .select('documento_id, status')
    .eq('nota_fiscal_id', notaFiscalId)
    .eq('tipo_documento_codigo_snapshot', 'nf_xml')
    .not('documento_id', 'is', null)

  if (error) throw new Error(`Erro ao verificar documento XML existente: ${error.message}`)
  const documentoIds = (requisitos || [])
    .map((row) => (row as { documento_id: string | null }).documento_id)
    .filter(Boolean) as string[]
  if (documentoIds.length === 0) return false

  const { data: versoes, error: versionError } = await supabase
    .from('documento_versoes')
    .select('id')
    .in('documento_id', documentoIds)
    .in('status', ['enviado', 'aprovado', 'rejeitado', 'substituido'])
    .limit(1)

  if (versionError) throw new Error(`Erro ao verificar versao do XML existente: ${versionError.message}`)
  return !!versoes?.length
}

async function removerNotaFiscalParcial(
  input: {
    notaFiscalId: string
    cedenteId: string
    arquivoUrl?: string | null
    etapa: string
    context: CedenteUploadContext
  },
) {
  const admin = createAdminClient()
  const { data: requisitos } = await admin
    .from('documento_requisito_instancias')
    .select('documento_id')
    .eq('nota_fiscal_id', input.notaFiscalId)

  const documentoIds = Array.from(new Set(
    (requisitos || [])
      .map((row) => (row as { documento_id: string | null }).documento_id)
      .filter(Boolean) as string[],
  ))

  if (documentoIds.length > 0) {
    const { data: versoes } = await admin
      .from('documento_versoes')
      .select('bucket, path')
      .in('documento_id', documentoIds)

    const pathsPorBucket = new Map<string, string[]>()
    for (const version of versoes || []) {
      const row = version as { bucket?: string | null; path?: string | null }
      if (!row.bucket || !row.path) continue
      pathsPorBucket.set(row.bucket, [...(pathsPorBucket.get(row.bucket) || []), row.path])
    }

    for (const [bucket, paths] of pathsPorBucket.entries()) {
      const { error: documentStorageError } = await admin.storage.from(bucket).remove(paths)
      if (documentStorageError) {
        logUploadNf(`${input.etapa}_documento_storage_compensacao_erro`, {
          ...input.context,
          erro: documentStorageError,
          notaFiscalId: input.notaFiscalId,
        })
      }
    }

    await admin.from('documento_requisito_instancias').delete().eq('nota_fiscal_id', input.notaFiscalId)
    await admin.from('documento_vinculos').delete().eq('nota_fiscal_id', input.notaFiscalId)
    await admin.from('documento_versoes').delete().in('documento_id', documentoIds)
    await admin.from('documentos_repositorio').delete().in('id', documentoIds)
  } else {
    await admin.from('documento_requisito_instancias').delete().eq('nota_fiscal_id', input.notaFiscalId)
  }

  if (input.arquivoUrl) {
    const { error: storageError } = await admin.storage.from(buckets.notasFiscais).remove([input.arquivoUrl])
    if (storageError) logUploadNf(`${input.etapa}_storage_compensacao_erro`, { ...input.context, erro: storageError, notaFiscalId: input.notaFiscalId })
  }

  const { error: deleteError } = await admin
    .from('notas_fiscais')
    .delete()
    .eq('id', input.notaFiscalId)
    .eq('cedente_id', input.cedenteId)

  if (deleteError) {
    logUploadNf(`${input.etapa}_nf_compensacao_erro`, { ...input.context, erro: deleteError, notaFiscalId: input.notaFiscalId })
    throw new Error(`Nao foi possivel remover NF parcial: ${deleteError.message}`)
  }
}

async function recuperarDuplicidadeIncompleta(
  arquivo: File,
  context: CedenteUploadContext,
  chaveAcesso: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ArquivoResult | null> {
  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('id, cedente_id, cedente_fundo_id, fundo_id, arquivo_url, status')
    .eq('chave_acesso', chaveAcesso)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Erro ao verificar duplicidade da NF: ${error.message}`)
  if (!data) return null

  const existente = data as NfExistente
  const possuiXml = await notaFiscalPossuiDocumentoXml(supabase, existente.id)
  const acao = decidirAcaoDuplicidadeNotaFiscal({ existeNota: true, possuiXmlDocumentalValido: possuiXml })
  if (acao === 'conflito_xml_existente') {
    return { ok: false, error: `${arquivo.name}: ${mensagemDuplicidadeNotaFiscal(acao)}` }
  }

  logUploadNf('duplicidade_incompleta_recuperacao', { ...context, chaveAcesso, notaFiscalId: existente.id })
  await removerNotaFiscalParcial({
    notaFiscalId: existente.id,
    cedenteId: existente.cedente_id,
    arquivoUrl: existente.arquivo_url,
    etapa: 'duplicidade_incompleta',
    context,
  })
  return null
}

function contextoDocumentoDaNota(context: CedenteUploadContext, notaFiscalId: string) {
  return {
    fundoId: context.fundoId,
    cedenteId: context.cedente.id,
    cedenteFundoId: context.cedenteFundoId,
    entidadeTipo: 'nota_fiscal' as const,
    entidadeId: notaFiscalId,
  }
}

async function processarArquivo(
  arquivo: File,
  context: CedenteUploadContext,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<ArquivoResult> {
  const { cedente } = context
  const maxSize = 20 * 1024 * 1024
  const isXml = arquivo.name.toLowerCase().endsWith('.xml') ||
    arquivo.type === 'text/xml' || arquivo.type === 'application/xml'
  const isPdf = arquivo.type === 'application/pdf'
  const isImage = arquivo.type === 'image/jpeg' || arquivo.type === 'image/png'

  if (!isXml && !isPdf && !isImage) {
    return { ok: false, error: `${arquivo.name}: formato invalido. Aceitos: XML, PDF, JPG, PNG.` }
  }
  if (arquivo.size > maxSize) {
    return { ok: false, error: `${arquivo.name}: arquivo muito grande (max 20MB).` }
  }

  const cnpjLimpo = cedente.cnpj.replace(/\D/g, '')
  const timestamp = Date.now()
  const cleanName = arquivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const filePath = `${cnpjLimpo}/nf/${timestamp}_${cleanName}`

  try {
    if (isXml) {
      const xmlContent = await arquivo.text()
      const parsed = parseNFeXML(xmlContent)

      if (parsed.cnpj_emitente !== cnpjLimpo) {
        return { ok: false, error: `${arquivo.name}: CNPJ emitente (${parsed.cnpj_emitente}) diferente do seu CNPJ (${cnpjLimpo}).` }
      }

      if (parsed.chave_acesso) {
        const duplicidade = await recuperarDuplicidadeIncompleta(arquivo, context, parsed.chave_acesso, supabase)
        if (duplicidade) return duplicidade
      }

      const { error: uploadError } = await supabase.storage
        .from(buckets.notasFiscais).upload(filePath, arquivo)
      if (uploadError) {
        return { ok: false, error: `${arquivo.name}: erro no upload - ${uploadError.message}` }
      }

      const { data: nf, error: dbError } = await supabase
        .from('notas_fiscais')
        .insert({
          cedente_id: cedente.id,
          cedente_fundo_id: context.cedenteFundoId,
          fundo_id: context.fundoId,
          numero_nf: parsed.numero_nf,
          serie: parsed.serie || null,
          chave_acesso: parsed.chave_acesso || null,
          data_emissao: parsed.data_emissao,
          data_vencimento: parsed.data_vencimento || parsed.data_emissao,
          cnpj_emitente: parsed.cnpj_emitente,
          razao_social_emitente: parsed.razao_social_emitente,
          cnpj_destinatario: parsed.cnpj_destinatario,
          razao_social_destinatario: parsed.razao_social_destinatario,
          valor_bruto: parsed.valor_bruto,
          valor_liquido: parsed.valor_liquido,
          valor_icms: parsed.valor_icms,
          valor_iss: parsed.valor_iss,
          valor_pis: parsed.valor_pis,
          valor_cofins: parsed.valor_cofins,
          valor_ipi: parsed.valor_ipi,
          descricao_itens: parsed.descricao_itens || null,
          condicao_pagamento: parsed.condicao_pagamento || null,
          arquivo_url: filePath,
          status: 'submetida',
        } as never)
        .select('id').single()

      if (dbError) {
        await supabase.storage.from(buckets.notasFiscais).remove([filePath])
        logUploadNf('insert_nf_erro', { ...context, chaveAcesso: parsed.chave_acesso, erro: dbError })
        return { ok: false, error: `${arquivo.name}: erro ao salvar - ${dbError.message}` }
      }

      const nfData = nf as { id: string }
      try {
        await uploadDocumentoSeRequerido(nfData.id, 'nf_xml', arquivo, supabase, contextoDocumentoDaNota(context, nfData.id))
      } catch (error) {
        logUploadNf('registrar_xml_documental_erro', { ...context, chaveAcesso: parsed.chave_acesso, erro: error, notaFiscalId: nfData.id })
        try {
          await removerNotaFiscalParcial({
            notaFiscalId: nfData.id,
            cedenteId: cedente.id,
            arquivoUrl: filePath,
            etapa: 'registrar_xml_documental',
            context,
          })
        } catch (cleanupError) {
          return {
            ok: false,
            error: `${arquivo.name}: nao foi possivel registrar o XML no repositorio documental e a limpeza automatica falhou - ${cleanupError instanceof Error ? cleanupError.message : 'erro desconhecido'}`,
          }
        }
        return { ok: false, error: `${arquivo.name}: nao foi possivel registrar o XML no repositorio documental - ${error instanceof Error ? error.message : 'erro desconhecido'}` }
      }
      registrarLog({
        tipo_evento: 'NF_CADASTRADA',
        entidade_tipo: 'notas_fiscais',
        entidade_id: nfData.id,
        dados_depois: {
          ...(parsed as unknown as Record<string, unknown>),
          fundo_id: context.fundoId,
          cedente_fundo_id: context.cedenteFundoId,
        },
      }).catch(() => {})

      return { ok: true, id: nfData.id, isRascunho: false }

    } else {
      const { error: uploadError } = await supabase.storage
        .from(buckets.notasFiscais).upload(filePath, arquivo)
      if (uploadError) {
        return { ok: false, error: `${arquivo.name}: erro no upload - ${uploadError.message}` }
      }

      const today = new Date().toISOString().split('T')[0]
      let extracted: NfPdfExtracted = { campos_extraidos: [] }
      if (isPdf) {
        try {
          extracted = await extractDanfeFromPdf(Buffer.from(await arquivo.arrayBuffer()))
        } catch {
          // falha silenciosa — PDF fica como rascunho para preenchimento manual
        }
      }

      const { data: nf, error: dbError } = await supabase
        .from('notas_fiscais')
        .insert({
          cedente_id: cedente.id,
          cedente_fundo_id: context.cedenteFundoId,
          fundo_id: context.fundoId,
          numero_nf: extracted.numero_nf ?? '',
          serie: extracted.serie ?? null,
          chave_acesso: extracted.chave_acesso ?? null,
          data_emissao: extracted.data_emissao ?? today,
          data_vencimento: extracted.data_vencimento ?? today,
          cnpj_emitente: cnpjLimpo,
          razao_social_emitente: cedente.razao_social,
          cnpj_destinatario: extracted.cnpj_destinatario ?? '',
          razao_social_destinatario: extracted.razao_social_destinatario ?? '',
          valor_bruto: extracted.valor_bruto ?? 0,
          valor_liquido: extracted.valor_bruto ?? 0,
          valor_icms: 0, valor_iss: 0, valor_pis: 0, valor_cofins: 0, valor_ipi: 0,
          condicao_pagamento: extracted.condicao_pagamento ?? null,
          descricao_itens: extracted.descricao_itens ?? null,
          arquivo_url: filePath,
          status: 'rascunho',
        } as never)
        .select('id').single()

      if (dbError) {
        await supabase.storage.from(buckets.notasFiscais).remove([filePath])
        logUploadNf('insert_nf_rascunho_erro', { ...context, chaveAcesso: extracted.chave_acesso ?? null, erro: dbError })
        return { ok: false, error: `${arquivo.name}: erro ao salvar - ${dbError.message}` }
      }

      const nfData = nf as { id: string }
      if (isPdf) {
        try {
          await uploadDocumentoSeRequerido(nfData.id, 'nf_danfe_pdf', arquivo, supabase, contextoDocumentoDaNota(context, nfData.id))
        } catch (error) {
          logUploadNf('registrar_danfe_documental_erro', { ...context, chaveAcesso: extracted.chave_acesso ?? null, erro: error, notaFiscalId: nfData.id })
          await removerNotaFiscalParcial({
            notaFiscalId: nfData.id,
            cedenteId: cedente.id,
            arquivoUrl: filePath,
            etapa: 'registrar_danfe_documental',
            context,
          })
          return { ok: false, error: `${arquivo.name}: nao foi possivel registrar o DANFE no repositorio documental - ${error instanceof Error ? error.message : 'erro desconhecido'}` }
        }
      }

      return { ok: true, id: nfData.id, isRascunho: true }
    }
  } catch (e) {
    logUploadNf('erro_inesperado_processar_arquivo', { ...context, erro: e })
    return { ok: false, error: `${arquivo.name}: erro inesperado ao processar.` }
  }
}

// Upload multiplo de arquivos de NF (XML ou PDF) — processa em paralelo
export async function uploadNFs(formData: FormData): Promise<NfActionState> {
  await requireAuthenticated()
  const supabase = await createClient()
  const context = await resolverContextoUploadCedente(supabase)

  if ('error' in context) return { success: false, message: context.error }

  const arquivos = formData.getAll('arquivos') as File[]
  if (!arquivos || arquivos.length === 0) return { success: false, message: 'Nenhum arquivo selecionado.' }

  const resultados = await Promise.allSettled(
    arquivos.map((arquivo) => processarArquivo(arquivo, context, supabase))
  )

  const erros: string[] = []
  const nfsCriadas: string[] = []
  const nfsRascunho: string[] = []

  for (const r of resultados) {
    if (r.status === 'rejected') {
      erros.push('Erro inesperado ao processar arquivo.')
    } else if (!r.value.ok) {
      erros.push(r.value.error)
    } else {
      nfsCriadas.push(r.value.id)
      if (r.value.isRascunho) nfsRascunho.push(r.value.id)
    }
  }

  // Notificação não bloqueia a resposta ao usuário
  if (nfsCriadas.length > 0) {
    notificarGestores(
      'Novas NFs enviadas',
      `O cedente ${context.cedente.razao_social} enviou ${nfsCriadas.length} nota(s) fiscal(is) para analise.`,
      'nf_enviada'
    ).catch(() => {})
  }

  if (erros.length > 0 && nfsCriadas.length === 0) {
    return { success: false, message: erros.join('\n') }
  }

  const msg = nfsCriadas.length === 1
    ? '1 nota fiscal enviada com sucesso!'
    : `${nfsCriadas.length} notas fiscais enviadas com sucesso!`

  return {
    success: true,
    message: erros.length > 0 ? `${msg} (${erros.length} erro(s): ${erros.join('; ')})` : msg,
    ids: nfsCriadas,
    rascunhos: nfsRascunho,
  }
}

// Criar NF a partir de PDF/imagem com dados preenchidos manualmente pelo cedente
export async function criarNFManual(formData: FormData): Promise<NfActionState> {
  await requireAuthenticated()
  const supabase = await createClient()
  const context = await resolverContextoUploadCedente(supabase)
  if ('error' in context) return { success: false, message: context.error }
  const { cedente } = context

  const arquivo = formData.get('arquivo') as File | null
  if (!arquivo) {
    return { success: false, message: 'Arquivo nao encontrado.' }
  }

  const maxSize = 20 * 1024 * 1024
  if (arquivo.size > maxSize) {
    return { success: false, message: `${arquivo.name}: arquivo muito grande (max 20MB).` }
  }

  const numero_nf = (formData.get('numero_nf') as string || '').trim()
  const data_emissao = formData.get('data_emissao') as string
  const data_vencimento = formData.get('data_vencimento') as string
  const cnpj_destinatario = (formData.get('cnpj_destinatario') as string || '').replace(/\D/g, '')
  const razao_social_destinatario = (formData.get('razao_social_destinatario') as string || '').trim()
  const valor_bruto = parseFloat(formData.get('valor_bruto') as string) || 0
  const descricao_itens = (formData.get('descricao_itens') as string || '').trim()
  const condicao_pagamento = (formData.get('condicao_pagamento') as string || '').trim()

  if (!numero_nf) return { success: false, message: 'Numero da NF e obrigatorio.' }
  if (!data_emissao) return { success: false, message: 'Data de emissao e obrigatoria.' }
  if (!data_vencimento) return { success: false, message: 'Data de vencimento e obrigatoria.' }
  if (!cnpj_destinatario || cnpj_destinatario.length < 14) return { success: false, message: 'CNPJ do destinatario invalido.' }
  if (!razao_social_destinatario) return { success: false, message: 'Razao social do destinatario e obrigatoria.' }
  if (valor_bruto <= 0) return { success: false, message: 'Valor bruto deve ser maior que zero.' }

  const cnpjLimpo = cedente.cnpj.replace(/\D/g, '')
  const timestamp = Date.now()
  const cleanName = arquivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const filePath = `${cnpjLimpo}/nf/${timestamp}_${cleanName}`

  const { error: uploadError } = await supabase.storage
    .from(buckets.notasFiscais)
    .upload(filePath, arquivo)

  if (uploadError) {
    return { success: false, message: `Erro no upload: ${uploadError.message}` }
  }

  const { data: nf, error: dbError } = await supabase
    .from('notas_fiscais')
    .insert({
      cedente_id: cedente.id,
      cedente_fundo_id: context.cedenteFundoId,
      fundo_id: context.fundoId,
      numero_nf,
      serie: null,
      chave_acesso: null,
      data_emissao,
      data_vencimento,
      cnpj_emitente: cnpjLimpo,
      razao_social_emitente: cedente.razao_social,
      cnpj_destinatario,
      razao_social_destinatario,
      valor_bruto,
      valor_liquido: valor_bruto,
      valor_icms: 0,
      valor_iss: 0,
      valor_pis: 0,
      valor_cofins: 0,
      valor_ipi: 0,
      descricao_itens: descricao_itens || null,
      condicao_pagamento: condicao_pagamento || null,
      arquivo_url: filePath,
      status: 'submetida',
    } as never)
    .select('id')
    .single()

  if (dbError) {
    await supabase.storage.from(buckets.notasFiscais).remove([filePath])
    logUploadNf('insert_nf_manual_erro', { ...context, erro: dbError })
    return { success: false, message: `Erro ao salvar: ${dbError.message}` }
  }

  const nfData = nf as { id: string }

  if (arquivo.type === 'application/pdf') {
    try {
      await uploadDocumentoSeRequerido(nfData.id, 'nf_danfe_pdf', arquivo, supabase, contextoDocumentoDaNota(context, nfData.id))
    } catch (error) {
      logUploadNf('registrar_danfe_manual_documental_erro', { ...context, erro: error, notaFiscalId: nfData.id })
      await removerNotaFiscalParcial({
        notaFiscalId: nfData.id,
        cedenteId: cedente.id,
        arquivoUrl: filePath,
        etapa: 'registrar_danfe_manual_documental',
        context,
      })
      return { success: false, message: `Nao foi possivel registrar o DANFE no repositorio documental: ${error instanceof Error ? error.message : 'erro desconhecido'}` }
    }
  }

  await registrarLog({
    tipo_evento: 'NF_CADASTRADA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfData.id,
    dados_depois: { numero_nf, valor_bruto, cnpj_destinatario, fundo_id: context.fundoId, cedente_fundo_id: context.cedenteFundoId } as Record<string, unknown>,
  })

  await notificarGestores(
    'Nova NF enviada',
    `O cedente ${cedente.razao_social} enviou a NF ${numero_nf} para analise.`,
    'nf_enviada'
  )

  return { success: true, message: 'Nota fiscal enviada com sucesso!', ids: [nfData.id] }
}

// Salvar/atualizar dados de NF rascunho (preenchimento manual para PDF)
export async function salvarDadosNF(nfId: string, data: NotaFiscalFormData): Promise<NfActionState> {
  await requireAuthenticated()
  const supabase = await createClient()
  const cedente = await getCedenteDoUsuario()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  const validated = notaFiscalSchema.safeParse(data)

  if (!validated.success) {
    return {
      success: false,
      errors: validated.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  // Verificar CNPJ emitente
  const cnpjLimpo = cedente.cnpj.replace(/\D/g, '')
  const cnpjEmitenteLimpo = validated.data.cnpj_emitente.replace(/\D/g, '')
  if (cnpjEmitenteLimpo !== cnpjLimpo) {
    return { success: false, message: 'CNPJ emitente deve ser igual ao CNPJ do seu cadastro.' }
  }

  // Verificar duplicidade por chave de acesso
  if (validated.data.chave_acesso) {
    const { data: existing } = await supabase
      .from('notas_fiscais')
      .select('id')
      .eq('chave_acesso', validated.data.chave_acesso)
      .neq('id', nfId)
      .limit(1)

    if (existing && existing.length > 0) {
      return { success: false, message: 'Ja existe uma NF com esta chave de acesso.' }
    }
  }

  const { error } = await supabase
    .from('notas_fiscais')
    .update({
      numero_nf: validated.data.numero_nf,
      serie: validated.data.serie || null,
      chave_acesso: validated.data.chave_acesso || null,
      data_emissao: validated.data.data_emissao,
      data_vencimento: validated.data.data_vencimento,
      cnpj_emitente: cnpjEmitenteLimpo,
      razao_social_emitente: validated.data.razao_social_emitente,
      cnpj_destinatario: validated.data.cnpj_destinatario.replace(/\D/g, ''),
      razao_social_destinatario: validated.data.razao_social_destinatario,
      valor_bruto: validated.data.valor_bruto,
      valor_liquido: validated.data.valor_bruto,
      valor_icms: validated.data.valor_icms,
      valor_iss: validated.data.valor_iss,
      valor_pis: validated.data.valor_pis,
      valor_cofins: validated.data.valor_cofins,
      valor_ipi: validated.data.valor_ipi,
      descricao_itens: validated.data.descricao_itens || null,
      condicao_pagamento: validated.data.condicao_pagamento || null,
    } as never)
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)

  if (error) {
    console.error('[salvarDadosNF]', error.message)
    return { success: false, message: `Erro ao salvar: ${error.message}` }
  }

  return { success: true, message: 'Dados da NF salvos com sucesso.' }
}

// Submeter NF rascunho para analise
export async function submeterNF(nfId: string): Promise<NfActionState> {
  await requireAuthenticated()
  const supabase = await createClient()
  const cedente = await getCedenteDoUsuario()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  // Buscar NF para validar se esta completa
  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('*')
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)
    .eq('status', 'rascunho')
    .single()

  if (!nf) {
    return { success: false, message: 'NF nao encontrada ou nao esta em rascunho.' }
  }

  const nfData = nf as Record<string, unknown>

  // Validar campos obrigatorios
  if (!nfData.numero_nf || !nfData.cnpj_destinatario || !nfData.razao_social_destinatario || !(nfData.valor_bruto as number > 0)) {
    return { success: false, message: 'Preencha todos os campos obrigatorios antes de submeter.' }
  }

  const { error } = await supabase
    .from('notas_fiscais')
    .update({ status: 'submetida' } as never)
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)

  if (error) {
    return { success: false, message: `Erro ao submeter: ${error.message}` }
  }

  await registrarLog({
    tipo_evento: 'NF_SUBMETIDA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfId,
  })

  await notificarGestores(
    'NF submetida para analise',
    `O cedente ${cedente.razao_social} submeteu a NF ${nfData.numero_nf} para analise.`,
    'nf_submetida'
  )

  return { success: true, message: 'NF submetida para analise com sucesso!' }
}

// Cedente: excluir rascunho
export async function excluirRascunho(nfId: string): Promise<NfActionState> {
  await requireAuthenticated()
  const supabase = await createClient()
  const cedente = await getCedenteDoUsuario()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('id, arquivo_url')
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)
    .eq('status', 'rascunho')
    .single()

  if (!nf) {
    return { success: false, message: 'Rascunho nao encontrado ou ja foi submetido.' }
  }

  const nfData = nf as { id: string; arquivo_url: string | null }

  // Remover arquivo do storage antes de excluir o registro
  if (nfData.arquivo_url) {
    await supabase.storage.from(buckets.notasFiscais).remove([nfData.arquivo_url])
  }

  const { error } = await supabase
    .from('notas_fiscais')
    .delete()
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)

  if (error) {
    return { success: false, message: `Erro ao excluir: ${error.message}` }
  }

  return { success: true, message: 'Rascunho excluido.' }
}

// Cedente: excluir múltiplos rascunhos em lote
export async function excluirRascunhos(nfIds: string[]): Promise<NfActionState> {
  if (!nfIds.length) return { success: false, message: 'Nenhuma NF selecionada.' }

  await requireAuthenticated()
  const supabase = await createClient()
  const cedente = await getCedenteDoUsuario()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  const { data: nfs } = await supabase
    .from('notas_fiscais')
    .select('id, arquivo_url')
    .in('id', nfIds)
    .eq('cedente_id', cedente.id)
    .eq('status', 'rascunho')

  if (!nfs || nfs.length === 0) {
    return { success: false, message: 'Nenhum rascunho encontrado.' }
  }

  const nfsData = nfs as { id: string; arquivo_url: string | null }[]
  const arquivos = nfsData.map((n) => n.arquivo_url).filter(Boolean) as string[]
  if (arquivos.length > 0) {
    await supabase.storage.from(buckets.notasFiscais).remove(arquivos)
  }

  const idsConfirmados = nfsData.map((n) => n.id)
  const { error } = await supabase
    .from('notas_fiscais')
    .delete()
    .in('id', idsConfirmados)
    .eq('cedente_id', cedente.id)

  if (error) {
    return { success: false, message: `Erro ao excluir: ${error.message}` }
  }

  return { success: true, message: `${idsConfirmados.length} rascunho(s) excluido(s).` }
}

// Gestor: aprovar NF
export async function aprovarNF(nfId: string): Promise<NfActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { data: nfAntes } = await supabase
    .from('notas_fiscais')
    .select('status, numero_nf, cedente_id')
    .eq('id', nfId)
    .single()

  if (!nfAntes) {
    return { success: false, message: 'NF nao encontrada.' }
  }

  const nfData = nfAntes as { status: string; numero_nf: string; cedente_id: string }

  const { error } = await supabase
    .from('notas_fiscais')
    .update({ status: 'aprovada', aprovada_gestor_em: new Date().toISOString() } as never)
    .eq('id', nfId)

  if (error) {
    return { success: false, message: `Erro ao aprovar: ${error.message}` }
  }

  await notificarCedente(
    nfData.cedente_id,
    'NF aprovada',
    `Sua NF ${nfData.numero_nf} foi aprovada e esta disponivel para antecipacao.`,
    'nf_aprovada',
  )

  await registrarLog({
    tipo_evento: 'NF_APROVADA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfId,
    dados_antes: { status: nfData.status },
    dados_depois: { status: 'aprovada' },
  })

  return { success: true, message: 'NF aprovada com sucesso!' }
}

// Gestor: reprovar NF
export async function reprovarNF(nfId: string, motivo: string): Promise<NfActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  if (!motivo || motivo.trim().length === 0) {
    return { success: false, message: 'Motivo da reprovacao e obrigatorio.' }
  }

  const { data: nfAntes } = await supabase
    .from('notas_fiscais')
    .select('status, numero_nf, cedente_id')
    .eq('id', nfId)
    .single()

  if (!nfAntes) {
    return { success: false, message: 'NF nao encontrada.' }
  }

  const nfData = nfAntes as { status: string; numero_nf: string; cedente_id: string }

  const { error } = await supabase
    .from('notas_fiscais')
    .update({ status: 'cancelada' } as never)
    .eq('id', nfId)

  if (error) {
    return { success: false, message: `Erro ao reprovar: ${error.message}` }
  }

  await notificarCedente(
    nfData.cedente_id,
    'NF reprovada',
    `Sua NF ${nfData.numero_nf} foi reprovada. Motivo: ${motivo}`,
    'nf_reprovada',
  )

  await registrarLog({
    tipo_evento: 'NF_REPROVADA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfId,
    dados_antes: { status: nfData.status },
    dados_depois: { status: 'cancelada', motivo },
  })

  return { success: true, message: 'NF reprovada.' }
}

// Cedente: resubmeter NF que foi devolvida para ajuste
export async function resubmeterNFAjustada(nfId: string): Promise<NfActionState> {
  await requireAuthenticated()
  const supabase = await createClient()
  const cedente = await getCedenteDoUsuario()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('id, numero_nf, status')
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)
    .eq('status', 'requer_ajuste')
    .single()

  if (!nf) {
    return { success: false, message: 'NF nao encontrada ou nao esta aguardando ajuste.' }
  }

  const nfData = nf as { id: string; numero_nf: string; status: string }

  const { error } = await supabase
    .from('notas_fiscais')
    .update({ status: 'submetida', motivo_ajuste: null } as never)
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)

  if (error) {
    return { success: false, message: `Erro ao resubmeter: ${error.message}` }
  }

  await registrarLog({
    tipo_evento: 'NF_RESUBMETIDA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfId,
    dados_antes: { status: 'requer_ajuste' },
    dados_depois: { status: 'submetida' },
  })

  await notificarGestores(
    'NF resubmetida apos ajuste',
    `O cedente ${cedente.razao_social} resubmeteu a NF ${nfData.numero_nf} apos correcao.`,
    'nf_submetida'
  )

  return { success: true, message: 'NF resubmetida para analise!' }
}

// Gestor: solicitar ajuste na NF (devolve ao cedente para correcao)
export async function solicitarAjusteNF(nfId: string, motivo: string): Promise<NfActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  if (!motivo || motivo.trim().length === 0) {
    return { success: false, message: 'Motivo do ajuste e obrigatorio.' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { data: nfAntes } = await supabase
    .from('notas_fiscais')
    .select('status, numero_nf, cedente_id')
    .eq('id', nfId)
    .single()

  if (!nfAntes) {
    return { success: false, message: 'NF nao encontrada.' }
  }

  const nfData = nfAntes as { status: string; numero_nf: string; cedente_id: string }

  const { error } = await supabase
    .from('notas_fiscais')
    .update({ status: 'requer_ajuste', motivo_ajuste: motivo.trim() } as never)
    .eq('id', nfId)

  if (error) {
    return { success: false, message: `Erro ao solicitar ajuste: ${error.message}` }
  }

  await notificarCedente(
    nfData.cedente_id,
    'Ajuste solicitado na NF',
    `Sua NF ${nfData.numero_nf} requer ajuste. Motivo: ${motivo.trim()}`,
    'nf_ajuste_solicitado',
  )

  await registrarLog({
    tipo_evento: 'NF_AJUSTE_SOLICITADO',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfId,
    dados_antes: { status: nfData.status },
    dados_depois: { status: 'requer_ajuste', motivo_ajuste: motivo.trim() },
  })

  return { success: true, message: 'Ajuste solicitado. Cedente sera notificado.' }
}

export async function aprovarNFsLote(ids: string[]): Promise<NfActionState> {
  if (!ids.length) return { success: false, message: 'Nenhuma NF selecionada.' }

  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') return { success: false, message: 'Acesso negado.' }

  const { data: elegíveis } = await supabase
    .from('notas_fiscais')
    .select('id, numero_nf, cedente_id')
    .in('id', ids)
    .in('status', ['submetida', 'em_analise'])

  if (!elegíveis || elegíveis.length === 0) {
    return { success: false, message: 'Nenhuma NF elegivel (status deve ser submetida ou em analise).' }
  }

  const nfs = elegíveis as { id: string; numero_nf: string; cedente_id: string }[]
  const idsAprovados = nfs.map((n) => n.id)

  const { error } = await supabase
    .from('notas_fiscais')
    .update({ status: 'aprovada', aprovada_gestor_em: new Date().toISOString() } as never)
    .in('id', idsAprovados)

  if (error) return { success: false, message: `Erro ao aprovar: ${error.message}` }

  // Agrupar por cedente para enviar uma notificacao por cedente
  const porCedente = new Map<string, string[]>()
  for (const nf of nfs) {
    const nums = porCedente.get(nf.cedente_id) || []
    nums.push(nf.numero_nf)
    porCedente.set(nf.cedente_id, nums)
  }
  await Promise.allSettled(
    [...porCedente.entries()].map(([cedenteId, numeros]) =>
      notificarCedente(
        cedenteId,
        'NFs aprovadas',
        `As NFs ${numeros.join(', ')} foram aprovadas e estao disponiveis para antecipacao.`,
        'nf_aprovada',
      )
    )
  )

  await registrarLog({
    tipo_evento: 'NFS_APROVADAS_LOTE',
    entidade_tipo: 'notas_fiscais',
    entidade_id: idsAprovados[0],
    dados_depois: { ids: idsAprovados, quantidade: idsAprovados.length },
  })

  return { success: true, message: `${idsAprovados.length} NF(s) aprovada(s) com sucesso!` }
}

export async function reprovarNFsLote(ids: string[], motivo: string): Promise<NfActionState> {
  if (!ids.length) return { success: false, message: 'Nenhuma NF selecionada.' }
  if (!motivo.trim()) return { success: false, message: 'Motivo obrigatorio.' }

  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') return { success: false, message: 'Acesso negado.' }

  const { data: elegíveis } = await supabase
    .from('notas_fiscais')
    .select('id, numero_nf, cedente_id')
    .in('id', ids)
    .in('status', ['submetida', 'em_analise'])

  if (!elegíveis || elegíveis.length === 0) {
    return { success: false, message: 'Nenhuma NF elegivel para reprovacao.' }
  }

  const nfs = elegíveis as { id: string; numero_nf: string; cedente_id: string }[]
  const idsReprovados = nfs.map((n) => n.id)

  const { error } = await supabase
    .from('notas_fiscais')
    .update({ status: 'cancelada' } as never)
    .in('id', idsReprovados)

  if (error) return { success: false, message: `Erro ao reprovar: ${error.message}` }

  const porCedente = new Map<string, string[]>()
  for (const nf of nfs) {
    const nums = porCedente.get(nf.cedente_id) || []
    nums.push(nf.numero_nf)
    porCedente.set(nf.cedente_id, nums)
  }
  await Promise.allSettled(
    [...porCedente.entries()].map(([cedenteId, numeros]) =>
      notificarCedente(
        cedenteId,
        'NFs reprovadas',
        `As NFs ${numeros.join(', ')} foram reprovadas. Motivo: ${motivo}`,
        'nf_reprovada',
      )
    )
  )

  await registrarLog({
    tipo_evento: 'NFS_REPROVADAS_LOTE',
    entidade_tipo: 'notas_fiscais',
    entidade_id: idsReprovados[0],
    dados_depois: { ids: idsReprovados, quantidade: idsReprovados.length, motivo },
  })

  return { success: true, message: `${idsReprovados.length} NF(s) reprovada(s).` }
}
