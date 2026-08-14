import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { validarFundoParaIngestao } from './fund-context'
import { processarArquivoRlx } from './parser'
import type { RlxIngestaoInput, RlxIngestaoResultado } from './types'

const STORAGE_BUCKET = 'financeiro-importacoes'
const MAX_FILE_SIZE = 20 * 1024 * 1024
const ACCEPTED_MIME_TYPES = new Set(['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream'])

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Credenciais server-side do Supabase nao configuradas.')
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

function safeFileName(value: string) {
  const cleaned = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
  return cleaned.slice(-180) || 'arquivo.csv'
}

function validateInput(input: RlxIngestaoInput) {
  if (!/^[0-9a-f-]{36}$/i.test(input.fundoId)) throw new Error('Fundo invalido.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dataReferencia)) throw new Error('Data de referencia invalida.')
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(input.provedor)) throw new Error('Namespace do provedor invalido.')
  if (!input.nomeArquivo.toLowerCase().endsWith('.csv')) throw new Error('Somente arquivos CSV sao aceitos.')
  if (!input.arquivo.byteLength || input.arquivo.byteLength > MAX_FILE_SIZE) throw new Error('O arquivo deve possuir ate 20 MB.')
  if (input.mimeType && !ACCEPTED_MIME_TYPES.has(input.mimeType)) throw new Error('Tipo MIME do arquivo nao permitido.')
  if (input.origem !== 'CRON' && input.integracaoFundoVersaoId) {
    throw new Error('Somente importacao automatica pode registrar linhagem de integracao.')
  }
  if (input.origem === 'CRON' && !input.integracaoFundoVersaoId) {
    throw new Error('Importacao automatica exige a versao tecnica resolvida.')
  }
}

async function audit(input: { tipoEvento: string; importacaoId: string; fundoId: string; atorUsuarioId?: string | null; correlationId: string; dados?: Record<string, unknown> }) {
  const supabase = createAdminClient()
  const { error } = await supabase.from('plataforma_auditoria').insert({
    tipo_evento: input.tipoEvento,
    ator_usuario_id: input.atorUsuarioId ?? null,
    origem: 'rlx_ingestao_financeira',
    correlation_id: input.correlationId,
    dados: { importacao_id: input.importacaoId, fundo_id: input.fundoId, ...input.dados },
  })
  if (error) throw new Error(`Nao foi possivel registrar auditoria financeira: ${error.message}`)
}

export async function ingerirArquivoFinanceiroRlx(input: RlxIngestaoInput): Promise<RlxIngestaoResultado> {
  validateInput(input)
  const supabase = createAdminClient()
  const hash = createHash('sha256').update(input.arquivo).digest('hex')
  const resultado = processarArquivoRlx({ arquivo: input.arquivo, tipoBase: input.tipoBase, fundoId: input.fundoId, dataReferencia: input.dataReferencia, provedor: input.provedor })

  const { data: duplicate, error: duplicateError } = await supabase
    .from('rlx_importacoes_financeiras')
    .select('id,status')
    .eq('fundo_id', input.fundoId)
    .eq('tipo_base', input.tipoBase)
    .eq('data_referencia', input.dataReferencia)
    .eq('hash_conteudo', hash)
    .maybeSingle()
  if (duplicateError) throw new Error(`Nao foi possivel validar a idempotencia: ${duplicateError.message}`)
  if (duplicate) {
    return { importacaoId: duplicate.id, status: duplicate.status, duplicada: true, resultado }
  }

  const { data: fundo, error: fundoError } = await supabase.from('fundos').select('id,ativo').eq('id', input.fundoId).maybeSingle()
  if (fundoError) throw new Error(`Nao foi possivel validar o fundo: ${fundoError.message}`)
  validarFundoParaIngestao(fundo)

  const importacaoId = randomUUID()
  const correlationId = randomUUID()
  const storagePath = `${input.fundoId}/${input.tipoBase.toLowerCase()}/${input.dataReferencia}/${importacaoId}/${safeFileName(input.nomeArquivo)}`
  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, input.arquivo, {
    contentType: input.mimeType || 'text/csv',
    upsert: false,
  })
  if (uploadError) throw new Error(`Nao foi possivel preservar o arquivo bruto: ${uploadError.message}`)

  try {
    const { error: importError } = await supabase.from('rlx_importacoes_financeiras').insert({
      id: importacaoId,
      fundo_id: input.fundoId,
      provedor: input.provedor,
      tipo_base: input.tipoBase,
      data_referencia: input.dataReferencia,
      layout_nome: resultado.layoutNome,
      versao_layout: resultado.versaoLayout,
      status: 'VALIDANDO',
      completude: resultado.completude,
      origem: input.origem,
      integracao_fundo_versao_id: input.integracaoFundoVersaoId ?? null,
      hash_conteudo: hash,
      nome_arquivo: input.nomeArquivo,
      mime_type: input.mimeType || 'text/csv',
      tamanho_bytes: input.arquivo.byteLength,
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      encoding_detectado: resultado.encoding,
      correlation_id: correlationId,
      criado_por: input.atorUsuarioId ?? null,
      validacao_iniciada_em: new Date().toISOString(),
    })
    if (importError) throw new Error(importError.message)

    const { error: fileError } = await supabase.from('rlx_importacao_arquivos').insert({
      importacao_id: importacaoId,
      fundo_id: input.fundoId,
      nome_arquivo: input.nomeArquivo,
      mime_type: input.mimeType || 'text/csv',
      tamanho_bytes: input.arquivo.byteLength,
      hash_conteudo: hash,
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
    })
    if (fileError) throw new Error(fileError.message)
    await audit({ tipoEvento: 'RLX_IMPORTACAO_FINANCEIRA_RECEBIDA', importacaoId, fundoId: input.fundoId, atorUsuarioId: input.atorUsuarioId, correlationId, dados: { tipo_base: input.tipoBase, data_referencia: input.dataReferencia, hash_conteudo: hash } })
  } catch (error) {
    await supabase.from('rlx_importacoes_financeiras').delete().eq('id', importacaoId)
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath])
    throw new Error(`Nao foi possivel registrar o arquivo bruto: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
  }

  try {
    for (let offset = 0; offset < resultado.linhas.length; offset += 500) {
      const rows = resultado.linhas.slice(offset, offset + 500).map((linha) => ({
        importacao_id: importacaoId,
        fundo_id: input.fundoId,
        numero_linha: linha.numeroLinha,
        status: linha.status,
        dados_brutos: linha.dadosBrutos,
        dados_normalizados: linha.dadosNormalizados,
        erros: linha.erros,
        avisos: linha.avisos,
      }))
      const { error } = await supabase.from('rlx_importacao_linhas').insert(rows)
      if (error) throw new Error(error.message)
    }
    const invalidas = resultado.linhas.filter((row) => row.status === 'INVALIDA').length
    const warnings = resultado.linhas.filter((row) => row.status === 'WARNING').length
    const status = resultado.completude === 'INCOMPLETO' || invalidas > 0 ? 'FALHA' : 'VALIDA'
    const { error: updateError } = await supabase.from('rlx_importacoes_financeiras').update({
      status,
      completude: resultado.completude,
      linhas_total: resultado.linhas.length,
      linhas_validas: resultado.linhas.length - invalidas,
      linhas_invalidas: invalidas,
      linhas_warning: warnings,
      valor_total: resultado.valorTotal,
      erros: resultado.errosArquivo,
      metadados: { encoding: resultado.encoding },
      validacao_concluida_em: new Date().toISOString(),
      finalizada_em: new Date().toISOString(),
      erro_sanitizado: resultado.errosArquivo[0] ?? null,
    }).eq('id', importacaoId)
    if (updateError) throw new Error(updateError.message)
    await audit({ tipoEvento: status === 'VALIDA' ? 'RLX_IMPORTACAO_FINANCEIRA_VALIDADA' : 'RLX_IMPORTACAO_FINANCEIRA_FALHOU', importacaoId, fundoId: input.fundoId, atorUsuarioId: input.atorUsuarioId, correlationId, dados: { tipo_base: input.tipoBase, data_referencia: input.dataReferencia, linhas_invalidas: invalidas } })
    return { importacaoId, status, duplicada: false, resultado }
  } catch (error) {
    await supabase.from('rlx_importacoes_financeiras').update({
      status: 'FALHA',
      completude: 'INCOMPLETO',
      erros: [error instanceof Error ? error.message : 'Falha no staging.'],
      validacao_concluida_em: new Date().toISOString(),
      finalizada_em: new Date().toISOString(),
      erro_sanitizado: error instanceof Error ? error.message.slice(0, 500) : 'Falha no staging.',
    }).eq('id', importacaoId)
    throw new Error(`Nao foi possivel concluir o staging da importacao: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
  }
}

export async function publicarImportacaoFinanceiraRlx(importacaoId: string, correlationId = randomUUID()) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('publicar_importacao_financeira', { p_importacao_id: importacaoId, p_correlation_id: correlationId })
  if (error) throw new Error(`Nao foi possivel publicar a importacao: ${error.message}`)
  return data
}
