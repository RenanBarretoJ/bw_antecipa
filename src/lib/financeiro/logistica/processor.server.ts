import 'server-only'

import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { classificarLogisticaDasNotas } from './evidencias.server'
import { projetarPosicaoLogistica, somarValoresConhecidos } from './snapshot'
import { LOGISTICS_RULE_VERSION } from './types'
import { criarAssinaturaPosicaoLogistica, criarFingerprintLogistico } from './fingerprint'

type DynamicClient = ReturnType<typeof createAdminClient> & {
  from: (table: string) => ReturnType<ReturnType<typeof createAdminClient>['from']>
}
type Row = Record<string, unknown> & { id: string }

const admin = () => createAdminClient() as DynamicClient
export async function executarPosicaoLogisticaFinanceira(input: {
  fundoId: string
  dataReferencia: string
  atorUsuarioId: string
}) {
  const client = admin()
  const stockResult = await client.from('importacoes_financeiras')
    .select('id,fundo_id,provedor,data_referencia,status,completude,publicada_em')
    .eq('fundo_id', input.fundoId).eq('tipo_base', 'ESTOQUE')
    .eq('data_referencia', input.dataReferencia).eq('status', 'PUBLICADA')
    .order('publicada_em', { ascending: false }).limit(1).maybeSingle()
  if (stockResult.error) throw new Error(`Nao foi possivel resolver o Estoque D-1: ${stockResult.error.message}`)
  if (!stockResult.data) throw new Error('Nenhum Estoque D-1 publicado foi encontrado para a data informada.')
  const stock = stockResult.data as Row

  const matchingResult = await client.from('matching_execucoes').select('*')
    .eq('fundo_id', input.fundoId).eq('data_referencia', input.dataReferencia)
    .eq('status', 'CONCLUIDA').contains('input_import_ids', [stock.id])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (matchingResult.error) throw new Error(`Nao foi possivel resolver o matching do Estoque D-1: ${matchingResult.error.message}`)
  if (!matchingResult.data) throw new Error('Execute o matching da base de Estoque D-1 publicada antes da posicao logistica.')
  const matching = matchingResult.data as Row

  const [positionsResult, matchesResult] = await Promise.all([
    client.from('estoque_posicoes').select('*').eq('fundo_id', input.fundoId).eq('importacao_id', stock.id).order('id'),
    client.from('matching_resultados').select('*').eq('fundo_id', input.fundoId)
      .eq('execucao_id', matching.id).eq('origem_registro', 'ESTOQUE').order('origem_registro_id'),
  ])
  if (positionsResult.error) throw new Error(`Nao foi possivel carregar a posicao D-1: ${positionsResult.error.message}`)
  if (matchesResult.error) throw new Error(`Nao foi possivel carregar o matching da posicao: ${matchesResult.error.message}`)
  const positions = (positionsResult.data || []) as Row[]
  const matches = (matchesResult.data || []) as Row[]
  const matchByPosition = new Map(matches.map((row) => [String(row.origem_registro_id), row]))
  const missingMatch = positions.find((position) => !matchByPosition.has(position.id))
  if (missingMatch || matches.length !== positions.length) {
    throw new Error('O matching selecionado nao cobre integralmente a posicao de Estoque D-1 publicada.')
  }
  const matchedNoteIds = matches
    .filter((row) => row.status === 'MATCH_FORTE' && row.nota_fiscal_id)
    .map((row) => String(row.nota_fiscal_id))
  const noteMultiplicity = new Map<string, number>()
  for (const noteId of matchedNoteIds) noteMultiplicity.set(noteId, (noteMultiplicity.get(noteId) || 0) + 1)
  const classifications = await classificarLogisticaDasNotas(client, input.fundoId, matchedNoteIds)

  const rows = positions.map((position) => {
    const match = matchByPosition.get(position.id) || null
    const noteId = match?.status === 'MATCH_FORTE' && match.nota_fiscal_id ? String(match.nota_fiscal_id) : null
    return projetarPosicaoLogistica({
      estoque: position,
      matching: match as (Row & { origem_registro_id: string }) | null,
      classificacao: noteId ? classifications.get(noteId) || null : null,
      nfCompartilhada: noteId ? (noteMultiplicity.get(noteId) || 0) > 1 : false,
    })
  })
  const fingerprintLogistico = criarFingerprintLogistico(classifications)
  const signature = criarAssinaturaPosicaoLogistica({
    fundoId: input.fundoId,
    estoqueImportacaoId: stock.id,
    matchingExecucaoId: matching.id,
    fingerprintLogistico,
    regraVersao: LOGISTICS_RULE_VERSION,
  })
  const correlationId = randomUUID()
  const logisticaAsOf = new Date().toISOString()
  const totals = somarValoresConhecidos(rows)
  const payload = {
    fundo_id: input.fundoId,
    data_referencia: input.dataReferencia,
    estoque_importacao_id: stock.id,
    matching_execucao_id: matching.id,
    regra_versao: LOGISTICS_RULE_VERSION,
    logistica_as_of: logisticaAsOf,
    fingerprint_logistico: fingerprintLogistico,
    assinatura_execucao: signature,
    correlation_id: correlationId,
    criado_por: input.atorUsuarioId,
    status: 'CONCLUIDA',
    detalhes: {
      fonte_financeira: 'ESTOQUE_D1_PUBLICADO',
      valores_agregados_conhecidos: totals,
      valores_nulos_nao_convertidos_em_zero: true,
    },
    resultados: rows.map((row) => ({
      estoque_posicao_id: row.estoquePosicaoId,
      matching_resultado_id: row.matchingResultadoId,
      matching_status: row.matchingStatus,
      matching_metodo: row.matchingMetodo,
      status_vinculo: row.statusVinculo,
      vinculo_id: row.vinculoId,
      nota_fiscal_id: row.notaFiscalId,
      status_logistico: row.statusLogistico,
      id_recebivel: row.idRecebivel,
      seu_numero: row.seuNumero,
      numero_documento: row.numeroDocumento,
      cedente_nome: row.cedenteNome,
      cedente_documento: row.cedenteDocumento,
      sacado_nome: row.sacadoNome,
      sacado_documento: row.sacadoDocumento,
      data_vencimento: row.dataVencimento,
      valor_nominal: row.valorNominal,
      valor_aquisicao: row.valorAquisicao,
      valor_aquisicao_qualidade: row.valorAquisicaoQualidade,
      nf_compartilhada_entre_posicoes: row.nfCompartilhadaEntrePosicoes,
      evidencia_familia: row.evidenciaFamilia,
      documento_id: row.documentoId,
      documento_versao_id: row.documentoVersaoId,
      documento_analise_id: row.documentoAnaliseId,
      fundamento: row.fundamento,
      evidencias: row.evidencias,
      detalhes: row.detalhes,
    })),
  }
  const persisted = await client.rpc('persistir_posicao_logistica_execucao', { p_payload: payload })
  if (persisted.error) throw new Error(`Nao foi possivel persistir a posicao logistica: ${persisted.error.message}`)
  const persistedExecution = await client.from('posicao_logistica_execucoes')
    .select('id,correlation_id,logistica_as_of,assinatura_execucao,fingerprint_logistico,total_posicoes')
    .eq('id', String(persisted.data)).single()
  if (persistedExecution.error || !persistedExecution.data) {
    throw new Error(`Nao foi possivel confirmar a execucao logistica persistida: ${persistedExecution.error?.message || 'registro ausente'}`)
  }
  return {
    execucaoId: persistedExecution.data.id,
    total: persistedExecution.data.total_posicoes,
    signature: persistedExecution.data.assinatura_execucao,
    fingerprintLogistico: persistedExecution.data.fingerprint_logistico,
    correlationId: persistedExecution.data.correlation_id,
    logisticaAsOf: persistedExecution.data.logistica_as_of,
  }
}
