import 'server-only'

import { randomUUID } from 'node:crypto'
import { AuthorizationError, requireAuthenticated, type AppSupabaseClient } from '@/lib/auth/authorization'
import { buckets } from '@/lib/storage'
import { createAdminClient } from '@/lib/supabase/server'
import {
  construirPathDocumentoAssinado,
  DOCUMENTOS_ASSINADOS_OPERACAO,
  DocumentoAssinadoOperacaoError,
  exigirContextoFundoAtivoParaDocumentoAssinado,
  exigirGestorAtivoParaDocumentoAssinado,
  isUuid,
  persistirDocumentoAssinadoComCompensacao,
  validarPdfAssinado,
  type ColunaDocumentoAssinadoOperacao,
  type TipoDocumentoAssinadoOperacao,
} from './documentos-assinados'

type OperacaoDocumentoRow = {
  id: string
  cedente_fundo_id: string | null
  termo_assinado_url: string | null
  notificacao_assinada_url: string | null
  comprovante_pagamento_url: string | null
}

export type ContextoDocumentoAssinadoOperacao = {
  supabase: AppSupabaseClient
  usuarioId: string
  perfil: 'gestor'
  operacao: OperacaoDocumentoRow
  fundoId: string
}

function erroAutorizacao(error: unknown): never {
  if (error instanceof DocumentoAssinadoOperacaoError) throw error
  if (error instanceof AuthorizationError) {
    throw new DocumentoAssinadoOperacaoError(error.message, error.status, error.code)
  }
  throw error
}

export async function autorizarGestorDocumentoAssinado(
  operacaoId: string,
  client?: AppSupabaseClient,
): Promise<ContextoDocumentoAssinadoOperacao> {
  if (!isUuid(operacaoId)) {
    throw new DocumentoAssinadoOperacaoError('Operacao invalida.', 400, 'INVALID_OPERATION_ID')
  }

  try {
    const auth = await requireAuthenticated(client)
    exigirGestorAtivoParaDocumentoAssinado(auth.profile.role, auth.profile.status)

    // Esta leitura ocorre com o JWT real. O RLS 9B impede que um gestor
    // adversario descubra uma operacao de outro fundo.
    const { data: operacao, error: operacaoError } = await auth.supabase
      .from('operacoes')
      .select('id, cedente_fundo_id, termo_assinado_url, notificacao_assinada_url, comprovante_pagamento_url')
      .eq('id', operacaoId)
      .maybeSingle()

    if (operacaoError) throw new Error(`Falha ao consultar operacao: ${operacaoError.message}`)
    if (!operacao) {
      throw new DocumentoAssinadoOperacaoError('Operacao nao encontrada.', 404, 'OPERATION_NOT_FOUND')
    }

    const row = operacao as OperacaoDocumentoRow
    if (!row.cedente_fundo_id) {
      throw new DocumentoAssinadoOperacaoError('Operacao sem contexto de fundo valido.', 403, 'MISSING_FUND_CONTEXT')
    }

    const { data: vinculo, error: vinculoError } = await auth.supabase
      .from('cedente_fundos')
      .select('id, fundo_id, status')
      .eq('id', row.cedente_fundo_id)
      .eq('status', 'ativo')
      .maybeSingle()

    if (vinculoError) throw new Error(`Falha ao consultar vinculo da operacao: ${vinculoError.message}`)
    exigirContextoFundoAtivoParaDocumentoAssinado({
      vinculoAtivo: Boolean(vinculo),
      fundoAtivo: true,
      usuarioFundoAtivo: true,
    })
    if (!vinculo) throw new Error('Vinculo ativo indisponivel apos validacao.')

    const fundoId = String((vinculo as { fundo_id: string }).fundo_id)
    const [{ data: fundo, error: fundoError }, { data: usuarioFundo, error: usuarioFundoError }] = await Promise.all([
      auth.supabase.from('fundos').select('id, ativo').eq('id', fundoId).eq('ativo', true).maybeSingle(),
      auth.supabase
        .from('usuario_fundos')
        .select('id')
        .eq('usuario_id', auth.user.id)
        .eq('fundo_id', fundoId)
        .eq('status', 'ativo')
        .maybeSingle(),
    ])

    if (fundoError || usuarioFundoError) {
      throw new Error(`Falha ao validar acesso ao fundo: ${fundoError?.message || usuarioFundoError?.message}`)
    }
    exigirContextoFundoAtivoParaDocumentoAssinado({
      vinculoAtivo: true,
      fundoAtivo: Boolean(fundo),
      usuarioFundoAtivo: Boolean(usuarioFundo),
    })

    return {
      supabase: auth.supabase,
      usuarioId: auth.user.id,
      perfil: 'gestor',
      operacao: row,
      fundoId,
    }
  } catch (error) {
    return erroAutorizacao(error)
  }
}

function pathPertenceAOperacao(path: string, operacaoId: string): boolean {
  return path.startsWith(`operacoes/${operacaoId}/`) && !path.includes('..')
}

async function atualizarReferenciaComCompareAndSwap(input: {
  client: AppSupabaseClient
  operacaoId: string
  coluna: ColunaDocumentoAssinadoOperacao
  pathAnterior: string | null
  pathNovo: string
}): Promise<boolean> {
  let query = input.client
    .from('operacoes')
    .update({ [input.coluna]: input.pathNovo } as never)
    .eq('id', input.operacaoId)

  query = input.pathAnterior
    ? query.eq(input.coluna, input.pathAnterior)
    : query.is(input.coluna, null)

  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw new Error(`Falha ao registrar documento na operacao: ${error.message}`)
  return Boolean(data)
}

export async function anexarDocumentoAssinadoOperacao(input: {
  operacaoId: string
  tipo: TipoDocumentoAssinadoOperacao
  arquivo: File
}): Promise<{ tipo: TipoDocumentoAssinadoOperacao; atualizadoEm: string; substituiu: boolean }> {
  const contexto = await autorizarGestorDocumentoAssinado(input.operacaoId)
  const arquivo = await validarPdfAssinado(input.arquivo)
  const config = DOCUMENTOS_ASSINADOS_OPERACAO[input.tipo]
  const pathAnterior = contexto.operacao[config.coluna]
  const pathNovo = construirPathDocumentoAssinado(input.operacaoId, input.tipo, randomUUID())
  const atualizadoEm = new Date().toISOString()

  // A service role somente e criada depois de toda a autorizacao canonica.
  const admin = createAdminClient()

  const resultado = await persistirDocumentoAssinadoComCompensacao({
    uploadNovo: async () => {
      const { error } = await admin.storage.from(buckets.contratos).upload(pathNovo, arquivo.buffer, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
      })
      if (error) throw new Error(`Falha no upload privado: ${error.message}`)
    },
    atualizarReferencia: () => atualizarReferenciaComCompareAndSwap({
      client: contexto.supabase,
      operacaoId: input.operacaoId,
      coluna: config.coluna,
      pathAnterior,
      pathNovo,
    }),
    registrarAuditoria: async () => {
      const { error } = await admin.from('logs_auditoria').insert({
        usuario_id: contexto.usuarioId,
        ator_tipo: 'usuario',
        origem: 'api_operacao_documentos_assinados',
        ator_identificador: null,
        tipo_evento: pathAnterior ? 'DOCUMENTO_ASSINADO_SUBSTITUIDO' : 'DOCUMENTO_ASSINADO_ANEXADO',
        entidade_tipo: 'operacoes',
        entidade_id: input.operacaoId,
        dados_antes: {
          documento_presente: Boolean(pathAnterior),
          tipo_documento: input.tipo,
        },
        dados_depois: {
          documento_presente: true,
          tipo_documento: input.tipo,
          fundo_id: contexto.fundoId,
          perfil: contexto.perfil,
          nome_original: arquivo.nomeOriginal,
          tamanho_bytes: input.arquivo.size,
          mime_type: 'application/pdf',
          sha256: arquivo.sha256,
          atualizado_em: atualizadoEm,
        },
      } as never)
      if (error) throw new Error(`Falha ao registrar auditoria: ${error.message}`)
    },
    restaurarReferencia: async () => {
      const { data, error } = await admin
        .from('operacoes')
        .update({ [config.coluna]: pathAnterior } as never)
        .eq('id', input.operacaoId)
        .eq(config.coluna, pathNovo)
        .select('id')
        .maybeSingle()
      if (error) return false
      return Boolean(data)
    },
    removerNovo: async () => {
      const { error } = await admin.storage.from(buckets.contratos).remove([pathNovo])
      if (error) throw error
    },
    removerAnterior: async () => {
      if (!pathAnterior || !pathPertenceAOperacao(pathAnterior, input.operacaoId)) return
      const { error } = await admin.storage.from(buckets.contratos).remove([pathAnterior])
      if (error) throw error
    },
  }, Boolean(pathAnterior))

  if (resultado.limpezaAnteriorPendente) {
    console.warn('[documentos-assinados-operacao] objeto anterior pendente de limpeza', {
      operacao_id: input.operacaoId,
      tipo_documento: input.tipo,
    })
  }

  return { tipo: input.tipo, atualizadoEm, substituiu: Boolean(pathAnterior) }
}

export async function criarUrlDocumentoAssinadoOperacao(input: {
  operacaoId: string
  tipo: TipoDocumentoAssinadoOperacao
}): Promise<{ url: string; expiraEmSegundos: number }> {
  const contexto = await autorizarGestorDocumentoAssinado(input.operacaoId)
  const config = DOCUMENTOS_ASSINADOS_OPERACAO[input.tipo]
  const path = contexto.operacao[config.coluna]
  if (!path || !pathPertenceAOperacao(path, input.operacaoId)) {
    throw new DocumentoAssinadoOperacaoError('Documento nao encontrado.', 404, 'DOCUMENT_NOT_FOUND')
  }

  const expiraEmSegundos = 60
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(buckets.contratos).createSignedUrl(path, expiraEmSegundos)
  if (error || !data?.signedUrl) throw new Error(`Falha ao gerar URL temporaria: ${error?.message || 'sem URL'}`)

  return { url: data.signedUrl, expiraEmSegundos }
}
