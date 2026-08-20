'use server'

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireAuthenticated, requireGestor as requireGestorBase, type AppSupabaseClient, type AuthContext } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { notaFiscalSchema, type NotaFiscalFormData } from '@/lib/validations/nf'
import { extractDanfeFromPdf, type NfPdfExtracted } from '@/lib/pdf-nf-parser'
import { registrarLog } from './auditoria'
import { notificarGestores, notificarCedente } from './notificacao'
import { buckets } from '@/lib/storage'
import { uploadDocumentoSeRequerido } from '@/lib/documentos-v2/upload'
import { instanciarRequisitosDaNota } from '@/lib/documentos-v2/requisitos'
import { avaliarGateDuplicatasDaNota } from '@/lib/duplicatas/gate.server'
import { CedenteFundoError, mensagemOperacionalSemVinculo, resolverCedenteFundoAtivo } from '@/lib/fundos/cedente-fundo'
import { decidirAcaoDuplicidadeNotaFiscal, mensagemDuplicidadeNotaFiscal } from '@/lib/notas-fiscais/upload-context'
import { extrairCnpjDaChaveAcesso, formatarDetalhesBloqueioEmitente, validarXmlNfeParaUploadCedente } from '@/lib/notas-fiscais/emitente-autorizado'
import { obterFundoAtivoAutorizado } from '@/lib/fundos/fundo-ativo.server'
import { carregarContextoEventoNota, registrarEventoDominio } from '@/lib/eventos-dominio/registrar'
import { listarChecklistDaNota } from '@/lib/actions/documento-v2'
import { avaliarElegibilidadeSubmissaoNf } from '@/lib/notas-fiscais/elegibilidade-submissao'
import { avaliarElegibilidadeAprovacaoNf } from '@/lib/notas-fiscais/elegibilidade-aprovacao'
import { revalidatePath } from 'next/cache'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { carregarResumoDocumentalDasNotas } from '@/lib/notas-fiscais/resumo-documental-gestor.server'
import { resolverEstabelecimentoOrigem } from '@/lib/cedentes/estabelecimentos.server'

export type NfActionState = {
  success?: boolean
  code?: string
  errors?: Record<string, string[]>
  message?: string
  ids?: string[]
  rascunhos?: string[]
  data?: {
    id: string
    parsed?: Record<string, unknown>
  }
  lote?: {
    totalRecebidas: number
    totalAprovadas: number
    totalFalhas: number
    resultados: Array<{
      notaFiscalId: string
      success: boolean
      code?: string
      message?: string
      pendencias?: string[]
    }>
  }
} | undefined

async function requireGestor() {
  const context = await requireGestorBase()
  await exigirSessaoElevada(context)
  return context
}

async function registrarEventoNotaFiscal(
  supabase: AppSupabaseClient,
  nfId: string,
  input: {
    tipo_evento: string
    categoria: 'operacao' | 'aprovacao' | 'reprovacao' | 'analise'
    descricao: string
    metadata?: Record<string, unknown>
    visibilidade?: 'interno' | 'cedente' | 'ambos'
    origem?: string
    origem_evento?: string | null
    origem_registro_id?: string | null
    correlation_id?: string | null
  },
) {
  const contextoEvento = await carregarContextoEventoNota(supabase, nfId)
  await registrarEventoDominio({
    ...contextoEvento,
    tipo_evento: input.tipo_evento,
    categoria: input.categoria,
    descricao: input.descricao,
    metadata: {
      numero_nf: contextoEvento.numero_nf,
      status: contextoEvento.status,
      ...input.metadata,
    },
    visibilidade: input.visibilidade ?? 'ambos',
    origem: input.origem ?? 'nota_fiscal_action',
    origem_evento: input.origem_evento ?? null,
    origem_registro_id: input.origem_registro_id ?? null,
    correlation_id: input.correlation_id ?? null,
  }, supabase)
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
    if (resolved.contextoStatus === 'sem_vinculo_fundo' || !resolved.cedenteFundo || !resolved.fundo) {
      return { error: mensagemOperacionalSemVinculo() }
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
      if (error.code === 'SEM_VINCULO_FUNDO') return { error: mensagemOperacionalSemVinculo() }
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

  // Parcelas sao registradas antes do documento XML (para o fan-out do
  // requisito de boleto ja encontra-las na primeira instanciacao); por isso
  // uma falha depois desse ponto pode precisar limpar parcelas ja
  // persistidas. nota_fiscal_parcelas.nota_fiscal_id e ON DELETE RESTRICT,
  // entao precisa ser removida antes da NF (a instancia documental que
  // referencia parcela_id ja foi removida acima).
  await admin.from('nota_fiscal_parcelas').delete().eq('nota_fiscal_id', input.notaFiscalId)

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
      const preValidacao = validarXmlNfeParaUploadCedente({
        xmlContent,
        cnpjCedente: cedente.cnpj,
        permitirEstabelecimentoDoCedente: true,
      })

      if (!preValidacao.ok) {
        const detalhes = formatarDetalhesBloqueioEmitente({
          cnpjCedente: preValidacao.cnpjCedente,
          cnpjEmitente: preValidacao.cnpjEmitente,
        })
        logUploadNf('validar_emitente_xml_bloqueado', { ...context, chaveAcesso: null, erro: preValidacao.message })
        return { ok: false, error: `${arquivo.name}: ${preValidacao.message}${detalhes}` }
      }

      const parsed = preValidacao.parsed
      const estabelecimento = await resolverEstabelecimentoOrigem({
        supabase,
        cedenteId: cedente.id,
        fundoId: context.fundoId,
        cnpjEmitente: parsed.cnpj_emitente,
      })

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
          estabelecimento_id: estabelecimento.id,
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
           status: 'rascunho',
        } as never)
        .select('id').single()

      if (dbError) {
        await supabase.storage.from(buckets.notasFiscais).remove([filePath])
        logUploadNf('insert_nf_erro', { ...context, chaveAcesso: parsed.chave_acesso, erro: dbError })
        return { ok: false, error: `${arquivo.name}: erro ao salvar - ${dbError.message}` }
      }

      const nfData = nf as { id: string }

      // Registrar as parcelas ANTES de instanciar os requisitos documentais
      // (feito abaixo, dentro de uploadDocumentoSeRequerido -> instanciarRequisitosDaNota):
      // o fan-out do requisito de boleto (cardinalidade por_parcela) so
      // encontra parcelas se elas ja existirem em nota_fiscal_parcelas no
      // momento da primeira instanciacao. Instanciar antes de registrar as
      // parcelas deixava o boleto ausente ate a proxima leitura do checklist
      // reconciliar (documento-v2.ts), e nunca reconciliava para leitores
      // agregados que nao chamam instanciarRequisitosDaNota (ex.: resumo
      // documental do gestor usado na aprovacao da NF).
      if (parsed.parcelas.length > 0) {
        const { error: parcelasError } = await supabase.rpc('registrar_parcelas_nota_fiscal', {
          p_nota_fiscal_id: nfData.id,
          p_parcelas: parsed.parcelas,
        })
        if (parcelasError) {
          logUploadNf('registrar_parcelas_erro', { ...context, chaveAcesso: parsed.chave_acesso, erro: parcelasError, notaFiscalId: nfData.id })
          try {
            await removerNotaFiscalParcial({
              notaFiscalId: nfData.id,
              cedenteId: cedente.id,
              arquivoUrl: filePath,
              etapa: 'registrar_parcelas',
              context,
            })
          } catch (cleanupError) {
            return {
              ok: false,
              error: `${arquivo.name}: as parcelas do XML nao correspondem ao valor total da nota e a limpeza automatica falhou - ${cleanupError instanceof Error ? cleanupError.message : 'erro desconhecido'}`,
            }
          }
          return { ok: false, error: `${arquivo.name}: as parcelas do XML (<dup>) nao correspondem ao valor total da nota fiscal - ${parcelasError.message}` }
        }
      }

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
        tipo_evento: 'NF_SALVA_RASCUNHO',
        entidade_tipo: 'notas_fiscais',
        entidade_id: nfData.id,
        dados_depois: {
          ...(parsed as unknown as Record<string, unknown>),
          fundo_id: context.fundoId,
          cedente_fundo_id: context.cedenteFundoId,
        },
      }).catch(() => {})
      await registrarEventoNotaFiscal(supabase, nfData.id, {
        tipo_evento: 'nota_fiscal_salva_como_rascunho',
        categoria: 'operacao',
        descricao: 'Nota fiscal cadastrada por upload de XML.',
        metadata: {
          status_novo: 'rascunho',
          valor_bruto: parsed.valor_bruto,
          tipo_documento: 'nf_xml',
        },
        origem: 'upload_nf_xml',
      })

      return { ok: true, id: nfData.id, isRascunho: true }

    } else {
      let extracted: NfPdfExtracted = { campos_extraidos: [] }
      if (isPdf) {
        extracted = await extractDanfeFromPdf(Buffer.from(await arquivo.arrayBuffer()))
        if (!extracted.chave_acesso && !extracted.numero_nf) {
          return { ok: false, error: `${arquivo.name}: o PDF nao foi reconhecido como DANFE de uma NF.` }
        }
      }

      // O parser de DANFE não confia em CNPJ textual do PDF. Quando existe chave
      // oficial, o CNPJ emitente é derivado das posições fiscais da própria chave.
      // Arquivos sem chave preservam o fallback legado para a Matriz e deverão ser
      // confirmados no preenchimento manual antes da submissão.
      const cnpjEmitenteOficial = extracted.chave_acesso
        ? extrairCnpjDaChaveAcesso(extracted.chave_acesso)
        : cnpjLimpo
      const estabelecimento = await resolverEstabelecimentoOrigem({
        supabase,
        cedenteId: cedente.id,
        fundoId: context.fundoId,
        cnpjEmitente: cnpjEmitenteOficial,
      })

      const { error: uploadError } = await supabase.storage
        .from(buckets.notasFiscais).upload(filePath, arquivo)
      if (uploadError) {
        return { ok: false, error: `${arquivo.name}: erro no upload - ${uploadError.message}` }
      }

      const today = new Date().toISOString().split('T')[0]

      const { data: nf, error: dbError } = await supabase
        .from('notas_fiscais')
        .insert({
          cedente_id: cedente.id,
          cedente_fundo_id: context.cedenteFundoId,
          fundo_id: context.fundoId,
          estabelecimento_id: estabelecimento.id,
          numero_nf: extracted.numero_nf ?? '',
          serie: extracted.serie ?? null,
          chave_acesso: extracted.chave_acesso ?? null,
          data_emissao: extracted.data_emissao ?? today,
          data_vencimento: extracted.data_vencimento ?? today,
          cnpj_emitente: estabelecimento.cnpj,
          razao_social_emitente: estabelecimento.razaoSocial,
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

      await registrarEventoNotaFiscal(supabase, nfData.id, {
        tipo_evento: 'nota_fiscal_salva_como_rascunho',
        categoria: 'operacao',
        descricao: isPdf ? 'Nota fiscal cadastrada por upload de PDF.' : 'Nota fiscal cadastrada por upload.',
        metadata: {
          status_novo: 'rascunho',
          valor_bruto: extracted.valor_bruto ?? 0,
          tipo_documento: isPdf ? 'nf_danfe_pdf' : 'arquivo',
        },
        origem: isPdf ? 'upload_nf_pdf' : 'upload_nf_arquivo',
      })

      return { ok: true, id: nfData.id, isRascunho: true }
    }
  } catch (e) {
    logUploadNf('erro_inesperado_processar_arquivo', { ...context, erro: e })
    return { ok: false, error: `${arquivo.name}: ${e instanceof Error ? e.message : 'erro inesperado ao processar.'}` }
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
  if (erros.length > 0 && nfsCriadas.length === 0) {
    return { success: false, message: erros.join('\n') }
  }

  const msg = nfsCriadas.length === 1
    ? '1 nota fiscal salva como rascunho!'
    : `${nfsCriadas.length} notas fiscais salvas como rascunho!`

  revalidatePath('/cedente/notas-fiscais')
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
  let estabelecimento
  try {
    estabelecimento = await resolverEstabelecimentoOrigem({
      supabase,
      cedenteId: cedente.id,
      fundoId: context.fundoId,
      cnpjEmitente: cedente.cnpj,
    })
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'CNPJ emitente nao autorizado.' }
  }

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
      estabelecimento_id: estabelecimento.id,
      numero_nf,
      serie: null,
      chave_acesso: null,
      data_emissao,
      data_vencimento,
      cnpj_emitente: estabelecimento.cnpj,
      razao_social_emitente: estabelecimento.razaoSocial,
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
           status: 'rascunho',
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
    tipo_evento: 'NF_SALVA_RASCUNHO',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfData.id,
    dados_depois: { numero_nf, valor_bruto, cnpj_destinatario, fundo_id: context.fundoId, cedente_fundo_id: context.cedenteFundoId } as Record<string, unknown>,
  })
  await registrarEventoNotaFiscal(supabase, nfData.id, {
    tipo_evento: 'nota_fiscal_salva_como_rascunho',
    categoria: 'operacao',
    descricao: 'Nota fiscal cadastrada manualmente pelo cedente.',
    metadata: { status_novo: 'rascunho', valor_bruto, tipo_documento: arquivo.type === 'application/pdf' ? 'nf_danfe_pdf' : 'arquivo' },
    origem: 'upload_nf_manual',
  })

  return { success: true, message: 'Nota fiscal salva como rascunho!', ids: [nfData.id], rascunhos: [nfData.id] }
}

// Salvar/atualizar dados de NF rascunho (preenchimento manual para PDF)
export async function salvarDadosNF(nfId: string, data: NotaFiscalFormData): Promise<NfActionState> {
  await requireAuthenticated()
  const supabase = await createClient()
  const context = await resolverContextoUploadCedente(supabase)
  if ('error' in context) return { success: false, message: context.error }
  const { cedente } = context

  const validated = notaFiscalSchema.safeParse(data)

  if (!validated.success) {
    return {
      success: false,
      errors: validated.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const cnpjEmitenteLimpo = validated.data.cnpj_emitente.replace(/\D/g, '')
  let estabelecimento
  try {
    estabelecimento = await resolverEstabelecimentoOrigem({
      supabase,
      cedenteId: cedente.id,
      fundoId: context.fundoId,
      cnpjEmitente: cnpjEmitenteLimpo,
    })
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'CNPJ emitente nao autorizado.' }
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
      estabelecimento_id: estabelecimento.id,
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

// Submeter NF rascunho para analise. A transicao so ocorre por esta acao explicita.
export async function submeterNF(nfId: string): Promise<NfActionState> {
  await requireAuthenticated()
  const supabase = await createClient()
  const contextoUsuario = await getCedenteComUsuario(supabase)

  if (!contextoUsuario) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }
  const { cedente, userId } = contextoUsuario

  const { data: nf, error: nfError } = await supabase
    .from('notas_fiscais')
    .select('*')
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)
    .maybeSingle()

  if (nfError) return { success: false, message: `Nao foi possivel carregar a NF para submissao: ${nfError.message}` }
  if (!nf) return { success: false, code: 'NF_NOT_FOUND', message: 'NF nao encontrada ou nao pertence ao cedente autenticado.' }

  const nfData = nf as Record<string, unknown> & {
    id: string
    status: string
    cedente_fundo_id: string | null
    fundo_id: string | null
    numero_nf: string | null
    data_emissao: string
    data_vencimento: string
    cnpj_emitente: string
    cnpj_destinatario: string
    valor_bruto: number
  }

  if (nfData.status !== 'rascunho') {
    return { success: false, code: 'NF_NOT_RASCUNHO', message: `A NF ${nfData.numero_nf || nfId} nao esta em rascunho e nao pode ser submetida novamente.` }
  }

  if (!nfData.cedente_fundo_id || !nfData.fundo_id) {
    return { success: false, code: 'CONTEXTO_INVALIDO', message: 'O vinculo cedente-fundo da NF nao esta configurado.' }
  }

  const [{ data: vinculo, error: vinculoError }, { data: fundo, error: fundoError }] = await Promise.all([
    supabase
      .from('cedente_fundos')
      .select('id, status, fundo_id')
      .eq('id', nfData.cedente_fundo_id)
      .eq('cedente_id', cedente.id)
      .eq('fundo_id', nfData.fundo_id)
      .maybeSingle(),
    supabase
      .from('fundos')
      .select('id, ativo')
      .eq('id', nfData.fundo_id)
      .maybeSingle(),
  ])
  if (vinculoError || fundoError) {
    return { success: false, code: 'CONTEXTO_INVALIDO', message: `Nao foi possivel validar o vinculo ativo da NF: ${(vinculoError || fundoError)?.message}` }
  }

  let operacaoIncompativel = false
  const { data: operacaoLink } = await supabase
    .from('operacoes_nfs')
    .select('operacao_id')
    .eq('nota_fiscal_id', nfId)
    .limit(1)
    .maybeSingle()
  if (operacaoLink?.operacao_id) {
    const { data: operacao } = await supabase.from('operacoes').select('status').eq('id', operacaoLink.operacao_id).maybeSingle()
    operacaoIncompativel = !!operacao && !['cancelada', 'reprovada'].includes(String((operacao as { status?: string }).status))
  }

  let checklist
  try {
    checklist = await listarChecklistDaNota(nfId)
  } catch (error) {
    return { success: false, code: 'CHECKLIST_ERROR', message: `Nao foi possivel revalidar os requisitos documentais: ${error instanceof Error ? error.message : 'erro desconhecido'}` }
  }
  if (checklist.gateLogisticoPreCessao.exigido && !checklist.gateLogisticoPreCessao.permitidoSubmissao) {
    return {
      success: false,
      code: 'LOGISTICA_PRE_CESSAO_PENDENTE',
      message: 'A politica exige o envio de CT-e/DACTE ou Comprovante de Entrega antes da submissao.',
    }
  }

  const estadosSemPolitica = new Set(['sem_politica', 'nao_instanciado', 'erro'])
  const avaliacao = avaliarElegibilidadeSubmissaoNf({
    status: nfData.status,
    contexto: {
      cedenteFundoAtivo: !!vinculo && (vinculo as { status: string }).status === 'ativo',
      fundoAtivo: !!fundo && (fundo as { ativo: boolean }).ativo === true,
    },
    politica: { publicadaVigente: !estadosSemPolitica.has(checklist.estadoChecklist.estado) },
    requisitos: {
      instanciados: !estadosSemPolitica.has(checklist.estadoChecklist.estado),
      preCessao: checklist.preCessao.map((item) => ({
        nome: item.nome,
        obrigatorio: item.obrigatorio,
        satisfazSubmissao: item.satisfacaoSubmissao.satisfazSubmissao,
        bloqueiaFluxo: item.bloqueiaFluxo,
      })),
      validacaoEstruturalOk: checklist.estadoChecklist.estado !== 'erro',
      erroFiscal: null,
    },
    dadosObrigatoriosCompletos: Boolean(
      nfData.numero_nf
      && nfData.data_emissao
      && nfData.data_vencimento
      && nfData.cnpj_emitente
      && nfData.razao_social_emitente
      && nfData.cnpj_destinatario
      && nfData.razao_social_destinatario
      && Number(nfData.valor_bruto) > 0,
    ),
    operacaoIncompativel,
  })

  if (!avaliacao.elegivel) {
    return {
      success: false,
      code: 'NF_INELEGIVEL_SUBMISSAO',
      message: avaliacao.bloqueios.map((bloqueio) => bloqueio.mensagem).join(' '),
    }
  }

  try {
    const gateDuplicatas = await avaliarGateDuplicatasDaNota({
      supabase,
      nota: {
        id: nfData.id,
        cedente_id: cedente.id,
        cedente_fundo_id: nfData.cedente_fundo_id,
        fundo_id: nfData.fundo_id,
        numero_nf: nfData.numero_nf || '',
        data_emissao: nfData.data_emissao,
        data_vencimento: nfData.data_vencimento,
        cnpj_emitente: nfData.cnpj_emitente,
        cnpj_destinatario: nfData.cnpj_destinatario,
        valor_bruto: Number(nfData.valor_bruto),
      },
      etapa: 'submissao',
    })
    if (!gateDuplicatas.permitido) return { success: false, code: 'DUPLICATAS_PENDENTES', message: gateDuplicatas.mensagem || 'As duplicatas da NF possuem pendencias.' }
  } catch (error) {
    return { success: false, code: 'DUPLICATAS_ERROR', message: error instanceof Error ? error.message : 'Nao foi possivel validar as duplicatas da NF.' }
  }

  const submetidaEm = new Date().toISOString()
  const { data: atualizada, error: updateError } = await supabase
    .from('notas_fiscais')
    .update({ status: 'submetida', submetida_em: submetidaEm, submetida_por: userId } as never)
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)
    .eq('status', 'rascunho')
    .select('id, status, submetida_em, submetida_por')
    .maybeSingle()

  if (updateError) {
    return { success: false, code: 'NF_SUBMISSAO_ERROR', message: `Erro ao submeter: ${updateError.message}` }
  }
  if (!atualizada) {
    const { data: estadoAtual } = await supabase.from('notas_fiscais').select('status').eq('id', nfId).eq('cedente_id', cedente.id).maybeSingle()
    if ((estadoAtual as { status?: string } | null)?.status === 'submetida') {
      return { success: false, code: 'NF_ALREADY_SUBMITTED', message: 'Esta NF ja foi submetida para analise.' }
    }
    return { success: false, code: 'NF_CONCORRENCIA', message: 'A NF foi alterada por outra acao. Atualize a tela e tente novamente.' }
  }

  await registrarLog({
    tipo_evento: 'NF_SUBMETIDA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfId,
    dados_antes: { status: 'rascunho' },
    dados_depois: {
      status: 'submetida',
      submetida_em: submetidaEm,
      submetida_por: userId,
      obrigatorios_total: avaliacao.obrigatorios.total,
      obrigatorios_concluidos: avaliacao.obrigatorios.concluidos,
    },
  })
  await registrarEventoNotaFiscal(supabase, nfId, {
    tipo_evento: 'nota_fiscal_submetida',
    categoria: 'operacao',
    descricao: 'Nota fiscal submetida para analise.',
    metadata: {
      status_anterior: 'rascunho',
      status_novo: 'submetida',
      submetida_em: submetidaEm,
      submetida_por: userId,
      obrigatorios_total: avaliacao.obrigatorios.total,
      obrigatorios_concluidos: avaliacao.obrigatorios.concluidos,
      obrigatorios_pendentes: avaliacao.obrigatorios.pendentes,
    },
    origem: 'submissao_manual_cedente',
    origem_evento: 'nota_fiscal_submissao',
    origem_registro_id: nfId,
  })

  await notificarGestores(
    'NF submetida para analise',
    `O cedente ${cedente.razao_social} submeteu a NF ${nfData.numero_nf || nfId} para analise.`,
    'nf_submetida',
    `nf:${nfId}:submetida`
  )

  revalidatePath(`/cedente/notas-fiscais/${nfId}`)
  revalidatePath('/cedente/notas-fiscais')
  revalidatePath('/gestor/notas-fiscais')
  return { success: true, code: 'NF_SUBMITTED', message: 'NF submetida para analise com sucesso!', data: { id: nfId } }
}

type ExclusaoRascunhosRpc = {
  ids_excluidos?: string[]
  total_excluido?: number
  storage_objects?: Array<{ bucket?: string; path?: string }>
}

function mensagemErroExclusaoRascunho(message: string) {
  if (message.includes('Somente notas fiscais em rascunho')) {
    return 'Somente notas fiscais em rascunho podem ser excluidas.'
  }
  if (message.includes('movimentacao operacional')) {
    return 'Esta nota fiscal ja possui movimentacao operacional e nao pode ser excluida.'
  }
  if (message.includes('nao foram encontradas para este cedente')) {
    return 'Rascunho nao encontrado ou sem acesso para este cedente.'
  }
  if (message.includes('Cadastro de cedente nao encontrado')) {
    return 'Cadastro de cedente nao encontrado.'
  }
  return 'Nao foi possivel excluir o rascunho. Tente novamente.'
}

async function excluirRascunhosDoCedente(nfIds: string[]): Promise<NfActionState> {
  const ids = Array.from(new Set(nfIds.filter(Boolean)))
  if (ids.length === 0) return { success: false, message: 'Nenhuma NF selecionada.' }

  const context = await requireAuthenticated()
  const { data, error } = await context.supabase.rpc('excluir_notas_fiscais_rascunho_cedente', {
    p_nota_fiscal_ids: ids,
  })

  if (error) {
    console.error('[excluirRascunhosDoCedente] Falha transacional:', {
      codigo: error.code,
      total_solicitado: ids.length,
    })
    return { success: false, message: mensagemErroExclusaoRascunho(error.message) }
  }

  const resultado = (data || {}) as ExclusaoRascunhosRpc
  const idsExcluidos = resultado.ids_excluidos || []
  if (idsExcluidos.length !== ids.length) {
    return { success: false, message: 'Nao foi possivel confirmar a exclusao de todos os rascunhos.' }
  }

  const pathsPorBucket = new Map<string, string[]>()
  for (const object of resultado.storage_objects || []) {
    if (!object.bucket || !object.path) continue
    pathsPorBucket.set(object.bucket, [...(pathsPorBucket.get(object.bucket) || []), object.path])
  }

  const admin = createAdminClient()
  for (const [bucket, paths] of pathsPorBucket.entries()) {
    const { error: storageError } = await admin.storage.from(bucket).remove(paths)
    if (storageError) {
      console.error('[excluirRascunhosDoCedente] Falha ao limpar Storage apos commit:', {
        bucket,
        total_objetos: paths.length,
        codigo: storageError.name,
      })
    }
  }

  revalidatePath('/cedente/notas-fiscais')
  revalidatePath('/gestor/notas-fiscais')
  return {
    success: true,
    ids: idsExcluidos,
    message: idsExcluidos.length === 1
      ? 'Rascunho excluido.'
      : `${idsExcluidos.length} rascunho(s) excluido(s).`,
  }
}

// Cedente: excluir rascunho
export async function excluirRascunho(nfId: string): Promise<NfActionState> {
  return excluirRascunhosDoCedente([nfId])
}

// Cedente: excluir múltiplos rascunhos em lote
export async function excluirRascunhos(nfIds: string[]): Promise<NfActionState> {
  return excluirRascunhosDoCedente(nfIds)
}

// Gestor: aprovar NF
export async function aprovarNF(nfId: string): Promise<NfActionState> {
  const context = await requireGestor()
  const supabase = context.supabase
  const acessoNf = await validarNfsNoFundoAtivo(supabase, [nfId], context)
  if (!acessoNf?.success) return acessoNf

  const { data: nfAntes } = await supabase
    .from('notas_fiscais')
    .select('status, numero_nf, cedente_id')
    .eq('id', nfId)
    .single()

  if (!nfAntes) {
    return { success: false, message: 'NF nao encontrada.' }
  }

  const nfData = nfAntes as { status: string; numero_nf: string; cedente_id: string }
  // carregarResumoDocumentalDasNotas so LE documento_requisito_instancias --
  // nunca reconcilia. Sem isto, aprovar uma NF cujo checklist nunca foi
  // aberto poderia nao contar requisitos por_parcela (ex.: boleto) ainda
  // nao instanciados, permitindo ALLOW silencioso.
  try {
    await instanciarRequisitosDaNota(nfId, supabase)
  } catch (error) {
    return { success: false, message: `Nao foi possivel reconciliar os requisitos documentais da NF: ${error instanceof Error ? error.message : 'erro desconhecido'}` }
  }
  const checklist = await carregarResumoDocumentalDasNotas(supabase, [nfId])
  const documentos = checklist.avaliacoes.get(nfId)
  if (!documentos) {
    return { success: false, message: 'Nao foi possivel avaliar a documentacao aplicavel a NF.' }
  }
  const { data: gateLogisticoData, error: gateLogisticoError } = await supabase.rpc('avaliar_gate_logistico_pre_cessao_nfs', {
    p_nota_fiscal_ids: [nfId],
  })
  if (gateLogisticoError) {
    return { success: false, message: `Nao foi possivel validar o gate logistico da NF: ${gateLogisticoError.message}` }
  }
  const gateLogistico = ((gateLogisticoData || []) as Array<{ gate_exigido: boolean; status: string; permitido: boolean }>)[0]
  if (gateLogistico?.gate_exigido && !gateLogistico.permitido) {
    return { success: false, code: 'LOGISTICA_PRE_CESSAO_PENDENTE', message: 'A evidencia logistica obrigatoria ainda nao foi aprovada.' }
  }
  const avaliacaoAprovacao = avaliarElegibilidadeAprovacaoNf({
    status: nfData.status,
    documentos,
  })
  if (!avaliacaoAprovacao.elegivel) {
    return {
      success: false,
      message: avaliacaoAprovacao.bloqueios.map((bloqueio) => bloqueio.mensagem).join(' '),
    }
  }

  try {
    const { data: nfContexto, error: nfContextoError } = await supabase
      .from('notas_fiscais')
      .select('id, cedente_id, cedente_fundo_id, fundo_id, numero_nf, data_emissao, data_vencimento, cnpj_emitente, cnpj_destinatario, valor_bruto')
      .eq('id', nfId)
      .single()
    if (nfContextoError || !nfContexto) throw new Error(nfContextoError?.message || 'NF nao encontrada.')
    const gateDuplicatas = await avaliarGateDuplicatasDaNota({ supabase, nota: nfContexto, etapa: 'aprovacao' })
    if (!gateDuplicatas.permitido) return { success: false, code: 'DUPLICATAS_PENDENTES', message: gateDuplicatas.mensagem || 'As duplicatas da NF possuem pendencias.' }
  } catch (error) {
    return { success: false, code: 'DUPLICATAS_ERROR', message: error instanceof Error ? error.message : 'Nao foi possivel validar as duplicatas da NF.' }
  }

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
  await registrarEventoNotaFiscal(supabase, nfId, {
    tipo_evento: 'nota_fiscal_aprovada',
    categoria: 'aprovacao',
    descricao: 'Nota fiscal aprovada pela gestora.',
    metadata: { status_anterior: nfData.status, status_novo: 'aprovada' },
  })

  revalidatePath('/gestor/notas-fiscais')
  revalidatePath(`/gestor/notas-fiscais/${nfId}`)
  return { success: true, message: 'NF aprovada com sucesso!' }
}

// Gestor: reprovar NF
export async function reprovarNF(nfId: string, motivo: string): Promise<NfActionState> {
  const context = await requireGestor()
  const supabase = context.supabase

  if (!motivo || motivo.trim().length === 0) {
    return { success: false, message: 'Motivo da reprovacao e obrigatorio.' }
  }
  const acessoNf = await validarNfsNoFundoAtivo(supabase, [nfId], context)
  if (!acessoNf?.success) return acessoNf

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
  await registrarEventoNotaFiscal(supabase, nfId, {
    tipo_evento: 'nota_fiscal_reprovada',
    categoria: 'reprovacao',
    descricao: 'Nota fiscal reprovada pela gestora.',
    metadata: { status_anterior: nfData.status, status_novo: 'cancelada', motivo_resumido: motivo.slice(0, 120) },
  })

  revalidatePath('/gestor/notas-fiscais')
  revalidatePath(`/gestor/notas-fiscais/${nfId}`)
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
    .select('id, numero_nf, status, cedente_id, cedente_fundo_id, fundo_id, data_emissao, data_vencimento, cnpj_emitente, cnpj_destinatario, valor_bruto')
    .eq('id', nfId)
    .eq('cedente_id', cedente.id)
    .eq('status', 'requer_ajuste')
    .single()

  if (!nf) {
    return { success: false, message: 'NF nao encontrada ou nao esta aguardando ajuste.' }
  }

  const nfData = nf as {
    id: string
    numero_nf: string
    status: string
    cedente_id: string
    cedente_fundo_id: string | null
    fundo_id: string | null
    data_emissao: string
    data_vencimento: string
    cnpj_emitente: string
    cnpj_destinatario: string
    valor_bruto: number
  }

  try {
    const gateDuplicatas = await avaliarGateDuplicatasDaNota({ supabase, nota: nfData, etapa: 'submissao' })
    if (!gateDuplicatas.permitido) {
      return { success: false, code: 'DUPLICATAS_PENDENTES', message: gateDuplicatas.mensagem || 'As duplicatas da NF possuem pendencias.' }
    }
  } catch (error) {
    return { success: false, code: 'DUPLICATAS_ERROR', message: error instanceof Error ? error.message : 'Nao foi possivel validar as duplicatas da NF.' }
  }

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
  await registrarEventoNotaFiscal(supabase, nfId, {
    tipo_evento: 'nota_fiscal_resubmetida',
    categoria: 'operacao',
    descricao: 'Nota fiscal resubmetida apos ajuste.',
    metadata: { status_anterior: 'requer_ajuste', status_novo: 'submetida' },
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
  const context = await requireGestor()
  const supabase = context.supabase

  if (!motivo || motivo.trim().length === 0) {
    return { success: false, message: 'Motivo do ajuste e obrigatorio.' }
  }

  const acessoNf = await validarNfsNoFundoAtivo(supabase, [nfId], context)
  if (!acessoNf?.success) return acessoNf

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
  await registrarEventoNotaFiscal(supabase, nfId, {
    tipo_evento: 'nota_fiscal_ajuste_solicitado',
    categoria: 'analise',
    descricao: 'Ajuste solicitado na nota fiscal.',
    metadata: { status_anterior: nfData.status, status_novo: 'requer_ajuste', motivo_resumido: motivo.trim().slice(0, 120) },
  })

  revalidatePath('/gestor/notas-fiscais')
  revalidatePath(`/gestor/notas-fiscais/${nfId}`)
  return { success: true, message: 'Ajuste solicitado. Cedente sera notificado.' }
}

export async function aprovarNFsLote(ids: string[]): Promise<NfActionState> {
  const idsUnicos = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
  if (!idsUnicos.length) return { success: false, message: 'Nenhuma NF selecionada.' }

  const context = await requireGestor()
  const supabase = context.supabase
  const fundo = await resolverContextoFundoGestor(context)
  const { data: nfsData, error: nfsError } = await supabase
    .from('notas_fiscais')
    .select('id, numero_nf, cedente_id, cedente_fundo_id, status, fundo_id, data_emissao, data_vencimento, cnpj_emitente, cnpj_destinatario, valor_bruto')
    .in('id', idsUnicos)

  if (nfsError) return { success: false, message: `Erro ao validar as NFs: ${nfsError.message}` }
  const nfs = (nfsData || []) as Array<{
    id: string
    numero_nf: string
    cedente_id: string
    cedente_fundo_id: string | null
    status: string
    fundo_id: string | null
    data_emissao: string
    data_vencimento: string
    cnpj_emitente: string
    cnpj_destinatario: string
    valor_bruto: number
  }>
  const porId = new Map(nfs.map((nf) => [nf.id, nf]))
  const resultadosIniciais = idsUnicos.map((notaFiscalId) => {
    const nf = porId.get(notaFiscalId)
    if (!nf) return { notaFiscalId, success: false, code: 'nf_nao_encontrada', message: 'NF nao encontrada ou sem acesso.' }
    if (nf.fundo_id !== fundo.fundoId) return { notaFiscalId, success: false, code: 'fundo_invalido', message: 'NF nao pertence ao fundo ativo.' }
    if (!['submetida', 'em_analise'].includes(nf.status)) return { notaFiscalId, success: false, code: 'status_incompativel', message: 'Status deve ser submetida ou em analise.' }
    return { notaFiscalId, success: true }
  })
  const falhasIniciais = resultadosIniciais.filter((item) => !item.success)
  if (falhasIniciais.length > 0) {
    return {
      success: false,
      message: 'A aprovacao em lote e atomica. Uma ou mais NFs nao podem ser aprovadas.',
      lote: {
        totalRecebidas: idsUnicos.length,
        totalAprovadas: 0,
        totalFalhas: falhasIniciais.length,
        resultados: resultadosIniciais,
      },
    }
  }

  const { data: gatesLogisticosData, error: gatesLogisticosError } = await supabase.rpc('avaliar_gate_logistico_pre_cessao_nfs', {
    p_nota_fiscal_ids: idsUnicos,
  })
  if (gatesLogisticosError) return { success: false, message: `Nao foi possivel validar o gate logistico das NFs: ${gatesLogisticosError.message}` }
  const gatesLogisticos = (gatesLogisticosData || []) as Array<{ nota_fiscal_id: string; gate_exigido: boolean; status: string; permitido: boolean }>
  const bloqueiosLogisticos = gatesLogisticos.filter((item) => item.gate_exigido && !item.permitido)
  if (bloqueiosLogisticos.length > 0) {
    const idsBloqueados = new Set(bloqueiosLogisticos.map((item) => item.nota_fiscal_id))
    return {
      success: false,
      code: 'LOGISTICA_PRE_CESSAO_PENDENTE',
      message: 'A aprovacao em lote foi bloqueada: uma ou mais NFs exigem CT-e/DACTE ou Comprovante de Entrega aprovado.',
      lote: {
        totalRecebidas: idsUnicos.length,
        totalAprovadas: 0,
        totalFalhas: idsBloqueados.size,
        resultados: idsUnicos.map((notaFiscalId) => ({
          notaFiscalId,
          success: false,
          code: idsBloqueados.has(notaFiscalId) ? 'logistica_pre_cessao_pendente' : 'lote_atomico_bloqueado',
          message: idsBloqueados.has(notaFiscalId)
            ? 'Evidencia logistica aprovada obrigatoria antes da aprovacao.'
            : 'Nao aprovada porque outra NF do lote possui bloqueio logistico.',
        })),
      },
    }
  }

  try {
    const gatesDuplicatas = await Promise.all(nfs.map((nota) =>
      avaliarGateDuplicatasDaNota({ supabase, nota, etapa: 'aprovacao' })
        .then((gate) => ({ nota, gate }))))
    const bloqueadasPorDuplicata = gatesDuplicatas.filter(({ gate }) => !gate.permitido)
    if (bloqueadasPorDuplicata.length > 0) {
      const porIdDuplicata = new Map(bloqueadasPorDuplicata.map(({ nota, gate }) => [nota.id, gate]))
      return {
        success: false,
        code: 'DUPLICATAS_PENDENTES',
        message: 'A aprovacao em lote foi bloqueada: uma ou mais NFs possuem pendencias de Duplicata Mercantil.',
        lote: {
          totalRecebidas: idsUnicos.length,
          totalAprovadas: 0,
          totalFalhas: bloqueadasPorDuplicata.length,
          resultados: idsUnicos.map((notaFiscalId) => ({
            notaFiscalId,
            success: false,
            code: porIdDuplicata.has(notaFiscalId) ? 'duplicatas_pendentes' : 'lote_atomico_bloqueado',
            message: porIdDuplicata.get(notaFiscalId)?.mensagem || 'Nao aprovada porque outra NF do lote possui pendencia de duplicata.',
          })),
        },
      }
    }
  } catch (error) {
    return { success: false, code: 'DUPLICATAS_ERROR', message: error instanceof Error ? error.message : 'Nao foi possivel validar as duplicatas do lote.' }
  }

  // Mesma reconciliacao do caminho individual (aprovarNF): garante que
  // requisitos por_parcela ja instanciados existam antes do gate avaliar
  // o lote, evitando ALLOW silencioso para NFs cujo checklist nunca foi aberto.
  try {
    await Promise.all(idsUnicos.map((notaFiscalId) => instanciarRequisitosDaNota(notaFiscalId, supabase)))
  } catch (error) {
    return { success: false, message: `Nao foi possivel reconciliar os requisitos documentais do lote: ${error instanceof Error ? error.message : 'erro desconhecido'}` }
  }

  const documentacao = await carregarResumoDocumentalDasNotas(supabase, idsUnicos)
  const avaliacoesDocumentais = nfs.map((nf) => {
    const documentos = documentacao.avaliacoes.get(nf.id)
    const avaliacao = documentos
      ? avaliarElegibilidadeAprovacaoNf({ status: nf.status, documentos })
      : {
        elegivel: false,
        bloqueios: [{
          codigo: 'politica_documental_nao_resolvida' as const,
          mensagem: 'Nao foi possivel identificar a politica documental aplicavel a NF.',
        }],
      }
    return { nf, documentos, avaliacao }
  })
  const bloqueadas = avaliacoesDocumentais.filter((item) => !item.avaliacao.elegivel)
  if (bloqueadas.length > 0) {
    const bloqueadasPorId = new Map(bloqueadas.map((item) => [item.nf.id, item]))
    return {
      success: false,
      message: `Aprovacao em lote bloqueada. Verifique as pendencias das NFs: ${bloqueadas.map((item) => item.nf.numero_nf).join(', ')}.`,
      lote: {
        totalRecebidas: idsUnicos.length,
        totalAprovadas: 0,
        totalFalhas: bloqueadas.length,
        resultados: idsUnicos.map((notaFiscalId) => {
          const bloqueada = bloqueadasPorId.get(notaFiscalId)
          return bloqueada
            ? {
              notaFiscalId,
              success: false,
              code: bloqueada.avaliacao.bloqueios[0]?.codigo || 'documentos_nao_aprovados',
              message: bloqueada.avaliacao.bloqueios.map((item) => item.mensagem).join(' '),
              pendencias: Array.from(new Set([
                ...(bloqueada.documentos?.ausentesMaterializacao || []),
                ...(bloqueada.documentos?.requisitosPendentes || []),
              ])),
            }
            : {
              notaFiscalId,
              success: false,
              code: 'lote_atomico_bloqueado',
              message: 'Nao aprovada porque outra NF do lote possui bloqueio.',
            }
        }),
      },
    }
  }
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

  revalidatePath('/gestor/notas-fiscais')
  for (const id of idsAprovados) revalidatePath(`/gestor/notas-fiscais/${id}`)
  return {
    success: true,
    message: `${idsAprovados.length} NF(s) aprovada(s) com sucesso!`,
    lote: {
      totalRecebidas: idsUnicos.length,
      totalAprovadas: idsAprovados.length,
      totalFalhas: 0,
      resultados: idsAprovados.map((notaFiscalId) => ({ notaFiscalId, success: true })),
    },
  }
}

export async function reprovarNFsLote(ids: string[], motivo: string): Promise<NfActionState> {
  const idsUnicos = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
  if (!idsUnicos.length) return { success: false, message: 'Nenhuma NF selecionada.' }
  if (!motivo.trim()) return { success: false, message: 'Motivo obrigatorio.' }

  const context = await requireGestor()
  const supabase = context.supabase
  const acessoNfs = await validarNfsNoFundoAtivo(supabase, idsUnicos, context)
  if (!acessoNfs?.success) return acessoNfs

  const { data: elegíveis } = await supabase
    .from('notas_fiscais')
    .select('id, numero_nf, cedente_id')
    .in('id', idsUnicos)
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

  revalidatePath('/gestor/notas-fiscais')
  for (const id of idsReprovados) revalidatePath(`/gestor/notas-fiscais/${id}`)
  return { success: true, message: `${idsReprovados.length} NF(s) reprovada(s).` }
}

async function validarNfsNoFundoAtivo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nfIds: string[],
  authContext?: AuthContext,
): Promise<NfActionState> {
  const contexto = authContext
    ? { fundoId: (await resolverContextoFundoGestor(authContext)).fundoId }
    : await obterFundoAtivoAutorizado()
  if (!contexto.fundoId) return { success: false, message: 'Selecione um fundo ativo antes de executar esta ação.' }

  const idsUnicos = Array.from(new Set(nfIds.filter(Boolean)))
  if (idsUnicos.length === 0) return { success: false, message: 'Nenhuma NF informada.' }

  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('id, fundo_id')
    .in('id', idsUnicos)

  if (error) return { success: false, message: `Erro ao validar fundo das NFs: ${error.message}` }

  const rows = (data || []) as Array<{ id: string; fundo_id: string | null }>
  if (rows.length !== idsUnicos.length) return { success: false, message: 'Uma ou mais NFs não foram encontradas.' }
  if (rows.some((row) => row.fundo_id !== contexto.fundoId)) {
    return { success: false, message: 'Uma ou mais NFs não pertencem ao fundo ativo.' }
  }

  return { success: true }
}
