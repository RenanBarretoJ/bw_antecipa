import 'server-only'

import { randomUUID } from 'node:crypto'
import Decimal from 'decimal.js'
import { createAdminClient } from '@/lib/supabase/server'
import { resolverExpectativasCicloFinanceiro } from '@/lib/financeiro/ingestao/cron-contract'
import { classificarLogisticaDasNotas } from '@/lib/financeiro/logistica/evidencias.server'
import { calcularAgregadosPosicao, calcularExposicao, classificarOverlayCandidate } from './calculo'
import { criarAssinaturaExposicao } from './fingerprint'
import { EXPOSURE_RULE_VERSION, type ExposureBaseRow, type ExposureOverlayCandidate, type ExposureExecutionStatus, type ExposureQualityFlag } from './types'

type AdminClient = ReturnType<typeof createAdminClient>
type DynamicClient = AdminClient & { from: (table: string) => ReturnType<AdminClient['from']> }
type Row = Record<string, unknown> & { id: string }
const admin = () => createAdminClient() as DynamicClient
const nullable = (value: unknown) => value == null ? null : String(value)

async function resolvePolicy(client: DynamicClient, fundoId: string, dataOperacional: string) {
  const policyResult = await client.from('politicas_operacionais').select('id').eq('fundo_id', fundoId)
    .eq('padrao', true).eq('status', 'ativa').limit(1).maybeSingle()
  if (policyResult.error) throw new Error(`Nao foi possivel resolver a politica de exposicao: ${policyResult.error.message}`)
  if (!policyResult.data) return null
  const versionResult = await client.from('politica_operacional_versoes').select('id,controle_exposicao_logistica_ativo,limite_exposicao_em_transito_pct,vigente_desde,publicada_em')
    .eq('politica_operacional_id', policyResult.data.id).eq('fundo_id', fundoId).in('status', ['publicada', 'substituida'])
    .lte('vigente_desde', `${dataOperacional}T23:59:59.999-03:00`).or(`vigente_ate.is.null,vigente_ate.gte.${dataOperacional}T00:00:00-03:00`)
    .order('versao', { ascending: false }).limit(1).maybeSingle()
  if (versionResult.error) throw new Error(`Nao foi possivel resolver a versao da politica de exposicao: ${versionResult.error.message}`)
  return versionResult.data as Row | null
}

async function persist(client: DynamicClient, payload: Record<string, unknown>) {
  const result = await client.rpc('persistir_exposicao_execucao', { p_payload: payload })
  if (result.error) throw new Error(`Nao foi possivel persistir a exposicao: ${result.error.message}`)
  const confirmation = await client.from('exposicao_execucoes').select('*').eq('id', String(result.data)).single()
  if (confirmation.error || !confirmation.data) throw new Error(`Nao foi possivel confirmar a exposicao persistida: ${confirmation.error?.message || 'registro ausente'}`)
  return confirmation.data as Row
}

function basePayload(input: {
  fundoId: string; dataOperacional: string; d1: string; d2: string; overlayAsOf: string; actorId: string
  status: ExposureExecutionStatus; policy: Row | null; signatureState: Record<string, unknown>
}) {
  return {
    fundo_id: input.fundoId, data_operacional: input.dataOperacional,
    data_referencia_estoque: input.d1, data_referencia_pl: input.d2,
    overlay_as_of: input.overlayAsOf, regra_versao: EXPOSURE_RULE_VERSION,
    politica_operacional_versao_id: input.policy?.id || null,
    limite_referencia_pct: nullable(input.policy?.limite_exposicao_em_transito_pct),
    status: input.status, correlation_id: randomUUID(), criado_por: input.actorId,
    assinatura_execucao: criarAssinaturaExposicao({
      fundoId: input.fundoId, dataOperacional: input.dataOperacional, d1: input.d1, d2: input.d2,
      rule: EXPOSURE_RULE_VERSION, status: input.status, policy: input.policy?.id || null,
      limit: input.policy?.limite_exposicao_em_transito_pct || null, ...input.signatureState,
    }),
    overlay_itens: [], flags_qualidade: [], detalhes: { sem_decisao_de_elegibilidade: true },
  }
}

async function resolveOverlay(client: DynamicClient, input: {
  fundoId: string; dataOperacional: string; overlayAsOf: string; incorporatedNoteIds: Set<string>
}) {
  const links = await client.from('cedente_fundos').select('id').eq('fundo_id', input.fundoId)
  if (links.error) throw new Error(`Nao foi possivel resolver os vinculos do fundo: ${links.error.message}`)
  const linkIds = (links.data || []).map((row) => row.id)
  if (!linkIds.length) return []
  const operations = await client.from('operacoes').select('id,cedente_fundo_id,status,cessao_efetivada_em')
    .in('cedente_fundo_id', linkIds).in('status', ['em_andamento', 'inadimplente'])
    .not('cessao_efetivada_em', 'is', null).lte('cessao_efetivada_em', input.overlayAsOf)
  if (operations.error) throw new Error(`Nao foi possivel resolver o lifecycle do overlay: ${operations.error.message}`)
  const operationRows = (operations.data || []) as Row[]
  if (!operationRows.length) return []
  const operationIds = operationRows.map((row) => row.id)
  const [linksResult, calculationResult] = await Promise.all([
    client.from('operacoes_nfs').select('operacao_id,nota_fiscal_id').in('operacao_id', operationIds),
    client.from('operacao_calculo_nfs').select('operacao_id,nota_fiscal_id,valor_presente').eq('fundo_id', input.fundoId).in('operacao_id', operationIds),
  ])
  if (linksResult.error || calculationResult.error) throw new Error(`Nao foi possivel resolver as NFs do overlay: ${linksResult.error?.message || calculationResult.error?.message}`)
  const calculationByPair = new Map((calculationResult.data || []).map((row) => [`${row.operacao_id}:${row.nota_fiscal_id}`, row.valor_presente]))
  const operationById = new Map(operationRows.map((row) => [row.id, row]))
  const noteIds = [...new Set((linksResult.data || []).map((row) => row.nota_fiscal_id))]
  const logistics = await classificarLogisticaDasNotas(client, input.fundoId, noteIds)
  return (linksResult.data || []).map((link) => {
    const operation = operationById.get(link.operacao_id)!
    const logisticsState = logistics.get(link.nota_fiscal_id)
    const candidate: ExposureOverlayCandidate = {
      operacaoId: link.operacao_id, notaFiscalId: link.nota_fiscal_id,
      valorAquisicao: nullable(calculationByPair.get(`${link.operacao_id}:${link.nota_fiscal_id}`)),
      statusLogistico: logisticsState?.status || 'INDETERMINADA',
      jaIncorporadoEstoque: input.incorporatedNoteIds.has(link.nota_fiscal_id),
      operacaoEconomicaEm: String(operation.cessao_efetivada_em), dataOperacional: input.dataOperacional,
    }
    return {
      ...classificarOverlayCandidate(candidate),
      evidencias: logisticsState ? {
        familia_vencedora: logisticsState.familiaVencedora,
        documento_id: logisticsState.documentoId,
        versao_id: logisticsState.versaoId,
        analise_id: logisticsState.analiseId,
        analisado_em: logisticsState.analisadoEm,
        fundamento: logisticsState.fundamento,
        versao_resolvedor: logisticsState.versaoResolvedor,
      } : {},
    }
  })
}

export async function executarExposicaoFinanceira(input: {
  fundoId: string; dataOperacional: string; atorUsuarioId: string; overlayAsOf?: string
}) {
  const client = admin()
  const dates = resolverExpectativasCicloFinanceiro(input.dataOperacional)
  const d1 = dates.ESTOQUE
  const d2 = dates.CARTEIRA
  const overlayAsOf = input.overlayAsOf || new Date().toISOString()
  const policy = await resolvePolicy(client, input.fundoId, input.dataOperacional)
  if (!policy || policy.controle_exposicao_logistica_ativo !== true) {
    const row = await persist(client, basePayload({ fundoId: input.fundoId, dataOperacional: input.dataOperacional, d1, d2, overlayAsOf, actorId: input.atorUsuarioId, status: 'NAO_APLICAVEL', policy, signatureState: {} }))
    return { execucaoId: row.id, status: row.status, idempotente: true }
  }

  const positionResult = await client.from('posicao_logistica_execucoes').select('*')
    .eq('fundo_id', input.fundoId).eq('data_referencia', d1).eq('status', 'CONCLUIDA')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (positionResult.error) throw new Error(`Nao foi possivel resolver o snapshot P2.4: ${positionResult.error.message}`)
  if (!positionResult.data) {
    const row = await persist(client, basePayload({ fundoId: input.fundoId, dataOperacional: input.dataOperacional, d1, d2, overlayAsOf, actorId: input.atorUsuarioId, status: 'POSICAO_LOGISTICA_INDISPONIVEL', policy, signatureState: {} }))
    return { execucaoId: row.id, status: row.status }
  }
  const position = positionResult.data as Row

  const importResult = await client.from('importacoes_financeiras').select('id,publicada_em')
    .eq('fundo_id', input.fundoId).eq('tipo_base', 'CARTEIRA').eq('data_referencia', d2)
    .eq('status', 'PUBLICADA').eq('completude', 'COMPLETO_COM_DADOS')
    .order('publicada_em', { ascending: false }).limit(1).maybeSingle()
  if (importResult.error) throw new Error(`Nao foi possivel resolver a Carteira D-2: ${importResult.error.message}`)
  if (!importResult.data) {
    const row = await persist(client, { ...basePayload({ fundoId: input.fundoId, dataOperacional: input.dataOperacional, d1, d2, overlayAsOf, actorId: input.atorUsuarioId, status: 'PL_D2_INDISPONIVEL', policy, signatureState: { position: position.id } }), posicao_logistica_execucao_id: position.id, logistica_as_of: position.logistica_as_of })
    return { execucaoId: row.id, status: row.status }
  }
  const portfolioImport = importResult.data as Row
  const snapshotResult = await client.from('carteira_snapshots').select('id,importacao_id,patrimonio_liquido,publicada_em')
    .eq('importacao_id', portfolioImport.id).eq('fundo_id', input.fundoId).eq('data_referencia', d2).eq('vigente', true)
    .order('publicada_em', { ascending: false }).limit(1).maybeSingle()
  if (snapshotResult.error) throw new Error(`Nao foi possivel resolver o PL D-2: ${snapshotResult.error.message}`)
  if (!snapshotResult.data) {
    const row = await persist(client, { ...basePayload({ fundoId: input.fundoId, dataOperacional: input.dataOperacional, d1, d2, overlayAsOf, actorId: input.atorUsuarioId, status: 'PL_D2_INDISPONIVEL', policy, signatureState: { position: position.id, portfolioImport: portfolioImport.id } }), posicao_logistica_execucao_id: position.id, logistica_as_of: position.logistica_as_of, carteira_importacao_id: portfolioImport.id })
    return { execucaoId: row.id, status: row.status }
  }
  const snapshot = snapshotResult.data as Row
  const pl = new Decimal(String(snapshot.patrimonio_liquido))
  if (pl.lte(0)) {
    const row = await persist(client, { ...basePayload({ fundoId: input.fundoId, dataOperacional: input.dataOperacional, d1, d2, overlayAsOf, actorId: input.atorUsuarioId, status: 'PL_D2_INVALIDO', policy, signatureState: { position: position.id, snapshot: snapshot.id, pl: pl.toString() } }), posicao_logistica_execucao_id: position.id, logistica_as_of: position.logistica_as_of, carteira_importacao_id: portfolioImport.id, carteira_snapshot_id: snapshot.id, patrimonio_liquido_d2: pl.toString() })
    return { execucaoId: row.id, status: row.status }
  }

  const reconciliationPromise = client.from('conciliacao_execucoes').select('id').eq('fundo_id', input.fundoId)
    .eq('matching_execucao_id', String(position.matching_execucao_id)).eq('status', 'CONCLUIDA').order('created_at', { ascending: false }).limit(1).maybeSingle()
  const rowsResult = await client.from('posicao_logistica_resultados').select('id,status_vinculo,status_logistico,valor_aquisicao,nota_fiscal_id')
    .eq('execucao_id', position.id).eq('fundo_id', input.fundoId)
  if (rowsResult.error) throw new Error(`Nao foi possivel carregar os buckets P2.4: ${rowsResult.error.message}`)
  const sourceRows = (rowsResult.data || []) as Row[]
  const base = calcularAgregadosPosicao(sourceRows.map((row): ExposureBaseRow => ({
    statusVinculo: row.status_vinculo as ExposureBaseRow['statusVinculo'], statusLogistico: row.status_logistico as ExposureBaseRow['statusLogistico'], valorAquisicao: nullable(row.valor_aquisicao),
  })))
  const incorporated = new Set(sourceRows.map((row) => nullable(row.nota_fiscal_id)).filter((id): id is string => Boolean(id)))
  const [overlay, reconciliation] = await Promise.all([
    resolveOverlay(client, { fundoId: input.fundoId, dataOperacional: input.dataOperacional, overlayAsOf, incorporatedNoteIds: incorporated }),
    reconciliationPromise,
  ])
  const flags: ExposureQualityFlag[] = []
  if (base.quantidadeSemMatch) flags.push('TEM_SEM_MATCH')
  if (base.quantidadeIndeterminada) flags.push('TEM_INDETERMINADA')
  if (base.valorAusente) flags.push('TEM_VALOR_AUSENTE')
  if (reconciliation.error) throw new Error(`Nao foi possivel consultar liquidacoes parciais: ${reconciliation.error.message}`)
  if (reconciliation.data) {
    const partial = await client.from('conciliacao_resultados').select('id', { count: 'exact', head: true })
      .eq('execucao_id', reconciliation.data.id).eq('fundo_id', input.fundoId).eq('presente_d1', true).gt('liquidacoes_count', 0)
    if (partial.error) throw new Error(`Nao foi possivel validar liquidacoes parciais: ${partial.error.message}`)
    if ((partial.count || 0) > 0) flags.push('TEM_LIQUIDACAO_PARCIAL')
  }
  const calculated = calcularExposicao({ posicaoEmTransito: base.valorEmTransito, overlay, patrimonioLiquido: pl.toString(), limite: String(policy.limite_exposicao_em_transito_pct), baseFlags: flags })
  const signatureState = {
    position: position.id, portfolioImport: portfolioImport.id, snapshot: snapshot.id, pl: pl.toString(),
    overlay: overlay.map((item) => ({ operation: item.operacaoId, note: item.notaFiscalId, value: item.valorAquisicao, logistics: item.statusLogistico, reason: item.motivo })).sort((a, b) => `${a.operation}:${a.note}`.localeCompare(`${b.operation}:${b.note}`)),
  }
  const payload = {
    ...basePayload({ fundoId: input.fundoId, dataOperacional: input.dataOperacional, d1, d2, overlayAsOf, actorId: input.atorUsuarioId, status: 'CALCULADA', policy, signatureState }),
    posicao_logistica_execucao_id: position.id, logistica_as_of: position.logistica_as_of,
    carteira_importacao_id: portfolioImport.id, carteira_snapshot_id: snapshot.id,
    quantidade_posicao: sourceRows.length, quantidade_entregue: base.quantidadeEntregue,
    quantidade_em_transito_estoque: base.quantidadeEmTransito, quantidade_indeterminada: base.quantidadeIndeterminada,
    quantidade_sem_match: base.quantidadeSemMatch, quantidade_valor_aquisicao_ausente: base.valorAusente,
    quantidade_overlay: overlay.length, quantidade_ja_incorporada: overlay.filter((item) => item.motivo === 'JA_INCORPORADO_ESTOQUE').length,
    quantidade_nao_incorporada: overlay.filter((item) => item.motivo === 'OPERACAO_NAO_INCORPORADA').length,
    valor_posicao_total: base.valorTotal, valor_entregue: base.valorEntregue,
    valor_em_transito_estoque: base.valorEmTransito, valor_indeterminado: base.valorIndeterminado,
    valor_sem_match: base.valorSemMatch, patrimonio_liquido_d2: pl.toFixed(4), ...{
      overlay_total: calculated.overlayTotal, overlay_em_transito: calculated.overlayEmTransito,
      overlay_entregue: calculated.overlayEntregue, overlay_indeterminado: calculated.overlayIndeterminado,
      operacoes_ja_incorporadas_valor: calculated.operacoesJaIncorporadasValor,
      operacoes_nao_incorporadas_valor: calculated.operacoesNaoIncorporadasValor,
      exposicao_em_transito_total: calculated.exposicaoEmTransitoTotal,
      percentual_exposicao: calculated.percentualExposicao, classificacao_limite: calculated.classificacaoLimite,
      flags_qualidade: calculated.flagsQualidade,
    },
    overlay_itens: overlay.map((item) => ({
      operacao_id: item.operacaoId, nota_fiscal_id: item.notaFiscalId, operacao_economica_em: item.operacaoEconomicaEm,
      valor_aquisicao: item.valorAquisicao, status_logistico: item.statusLogistico,
      ja_incorporado_estoque: item.jaIncorporadoEstoque, incluido_no_numerador: item.incluidoNoNumerador,
      motivo: item.motivo, evidencias: { resolvedor: 'RLX_LOGISTICA_V1', ...item.evidencias },
    })),
    detalhes: { sem_decisao_de_elegibilidade: true, pl_sem_fallback: true, snapshot_p2_4_consumido: true },
  }
  const row = await persist(client, payload)
  return { execucaoId: row.id, status: row.status, percentual: row.percentual_exposicao, classificacao: row.classificacao_limite, signature: row.assinatura_execucao }
}

export async function simularExposicaoOperacao(input: { fundoId: string; operacaoId: string; atorUsuarioId: string }) {
  const client = admin()
  const currentResult = await client.from('exposicao_execucoes').select('*').eq('fundo_id', input.fundoId)
    .eq('status', 'CALCULADA').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (currentResult.error || !currentResult.data) throw new Error('Calcule a exposicao atual antes de simular uma operacao.')
  const current = currentResult.data as Row
  const operation = await client.from('operacoes').select('id,cedente_fundo_id').eq('id', input.operacaoId).maybeSingle()
  if (operation.error || !operation.data) throw new Error('Operacao nao encontrada para simulacao.')
  if (!operation.data.cedente_fundo_id) throw new Error('Operacao sem vinculo de fundo para simulacao.')
  const fundLink = await client.from('cedente_fundos').select('fundo_id').eq('id', operation.data.cedente_fundo_id).single()
  if (fundLink.error || fundLink.data.fundo_id !== input.fundoId) throw new Error('Operacao nao pertence ao fundo ativo.')
  const [links, calculations] = await Promise.all([
    client.from('operacoes_nfs').select('nota_fiscal_id').eq('operacao_id', input.operacaoId),
    client.from('operacao_calculo_nfs').select('nota_fiscal_id,valor_presente').eq('operacao_id', input.operacaoId).eq('fundo_id', input.fundoId),
  ])
  if (links.error || calculations.error) throw new Error('Nao foi possivel resolver a memoria financeira da simulacao.')
  const noteIds = (links.data || []).map((row) => row.nota_fiscal_id)
  const logistics = await classificarLogisticaDasNotas(client, input.fundoId, noteIds)
  const calcByNote = new Map((calculations.data || []).map((row) => [row.nota_fiscal_id, row.valor_presente]))
  let additionalTransit = new Decimal(0)
  let additionalIndeterminate = new Decimal(0)
  for (const noteId of noteIds) {
    const value = calcByNote.get(noteId)
    if (value == null) continue
    const status = logistics.get(noteId)?.status || 'INDETERMINADA'
    if (status === 'EM_TRANSITO') additionalTransit = additionalTransit.plus(String(value))
    if (status === 'INDETERMINADA') additionalIndeterminate = additionalIndeterminate.plus(String(value))
  }
  const pl = new Decimal(String(current.patrimonio_liquido_d2))
  const projectedValue = new Decimal(String(current.exposicao_em_transito_total)).plus(additionalTransit)
  const projectedPercent = projectedValue.dividedBy(pl).times(100).toDecimalPlaces(12).toFixed(12)
  const { classificarPercentualExposicao } = await import('./calculo')
  const result = {
    percentualAtual: String(current.percentual_exposicao), valorAdicionalEmTransito: additionalTransit.toFixed(4),
    percentualProjetado: projectedPercent, classificacaoAtual: current.classificacao_limite,
    classificacaoProjetada: classificarPercentualExposicao(projectedPercent, String(current.limite_referencia_pct)),
    valorIndeterminadoAdicional: additionalIndeterminate.toFixed(4), readOnly: true,
  }
  const audit = await client.from('logs_auditoria').insert({
    tipo_evento: 'EXPOSICAO_SIMULADA',
    entidade_tipo: 'operacoes',
    entidade_id: input.operacaoId,
    dados_depois: {
      fundo_id: input.fundoId,
      exposicao_execucao_id: current.id,
      classificacao_atual: result.classificacaoAtual,
      classificacao_projetada: result.classificacaoProjetada,
      read_only: true,
    },
    ator_tipo: 'usuario',
    origem: 'financeiro_exposicao',
    ator_identificador: input.atorUsuarioId,
  } as never)
  if (audit.error) throw new Error(`Nao foi possivel auditar a simulacao de exposicao: ${audit.error.message}`)
  return result
}
