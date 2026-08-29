import 'server-only'

import { randomUUID } from 'node:crypto'
import Decimal from 'decimal.js'
import { createAdminClient } from '@/lib/supabase/server'
import { resolverExpectativasCicloFinanceiro } from '@/lib/financeiro/ingestao/cron-contract'
import { createFinancialPipelineReadCache, executarMatchingFinanceiro, executarConciliacaoFinanceira } from '@/lib/financeiro/conciliacao/processor.server'
import { executarPosicaoLogisticaFinanceira } from '@/lib/financeiro/logistica/processor.server'
import { classificarLogisticaDasNotas } from '@/lib/financeiro/logistica/evidencias.server'
import { executarExposicaoFinanceira } from '@/lib/financeiro/exposicao/processor.server'
import { classificarExposicaoLogisticaCandidata } from '@/lib/financeiro/exposicao/calculo'
import { resolverBootstrapFinanceiro, type EstadoBootstrapFinanceiro } from '@/lib/financeiro/bootstrap/detector.server'
import { resolverPlReferencia } from '@/lib/financeiro/pl-referencia.server'
import { classificarGateRisco } from './classificador'
import { criarAssinaturaRisco } from './fingerprint'
import { RISK_GATE_RULE_VERSION, type RiskCandidateProjection, type RiskPolicy } from './types'

type DynamicClient = ReturnType<typeof createAdminClient> & {
  from: (table: string) => ReturnType<ReturnType<typeof createAdminClient>['from']>
}
type Row = Record<string, unknown> & { id: string }
const admin = () => createAdminClient() as DynamicClient
const text = (value: unknown) => value == null ? null : String(value)
const number = (value: unknown) => Number(value || 0)
const RISK_GATE_TIMEOUT_MS = Math.min(120_000, Math.max(5_000, Number(process.env.RISK_GATE_TIMEOUT_MS || 45_000)))

export type RiskGateTimings = {
  matchingMs: number
  reconciliationMs: number
  logisticsMs: number
  exposureMs: number
  candidateSimulationMs: number
  classificationMs: number
  persistenceMs: number
  totalMs: number
}

export type RiskGateDiagnosticStage =
  | 'policy'
  | 'matching'
  | 'reconciliation'
  | 'logistics'
  | 'exposure'
  | 'candidateSimulation'
  | 'classification'
  | 'persistence'

type RiskGateDiagnostics = {
  onStageChange?: (stage: RiskGateDiagnosticStage | null) => void
}

function elapsed(startedAt: number) {
  return Date.now() - startedAt
}

async function withRiskGateTimeout<T>(work: Promise<T>, timeoutMs = RISK_GATE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout do gate de risco apos ${timeoutMs} ms.`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function resolvePolicy(client: DynamicClient, input: {
  fundoId: string
  operacaoId?: string
  dataOperacional: string
}) {
  if (input.operacaoId) {
    const operation = await client.from('operacoes')
      .select('id,updated_at,status,politica_operacional_versao_id,cedente_fundo_id')
      .eq('id', input.operacaoId).maybeSingle()
    if (operation.error || !operation.data) throw new Error('Operacao nao encontrada para avaliacao de risco.')
    if (!operation.data.cedente_fundo_id) throw new Error('Operacao sem vinculo de fundo para avaliacao de risco.')
    const link = await client.from('cedente_fundos').select('fundo_id').eq('id', operation.data.cedente_fundo_id).single()
    if (link.error || link.data.fundo_id !== input.fundoId) throw new Error('Operacao nao pertence ao fundo da avaliacao de risco.')
    if (!operation.data.politica_operacional_versao_id) throw new Error('Operacao sem snapshot de politica operacional.')
    const version = await client.from('politica_operacional_versoes').select('*')
      .eq('id', operation.data.politica_operacional_versao_id).eq('fundo_id', input.fundoId).single()
    if (version.error || !version.data) throw new Error('Snapshot da politica da operacao nao encontrado.')
    return { version: version.data as Row, operation: operation.data as Row }
  }

  const policy = await client.from('politicas_operacionais').select('id').eq('fundo_id', input.fundoId)
    .eq('padrao', true).eq('status', 'ativa').limit(1).maybeSingle()
  if (policy.error) throw new Error(`Nao foi possivel resolver a politica de risco: ${policy.error.message}`)
  if (!policy.data) return { version: null, operation: null }
  const version = await client.from('politica_operacional_versoes').select('*')
    .eq('politica_operacional_id', policy.data.id).eq('fundo_id', input.fundoId)
    .in('status', ['publicada', 'substituida'])
    .lte('vigente_desde', `${input.dataOperacional}T23:59:59.999-03:00`)
    .or(`vigente_ate.is.null,vigente_ate.gte.${input.dataOperacional}T00:00:00-03:00`)
    .order('versao', { ascending: false }).limit(1).maybeSingle()
  if (version.error) throw new Error(`Nao foi possivel resolver a versao da politica de risco: ${version.error.message}`)
  return { version: version.data as Row | null, operation: null }
}

function fixedPolicyValue<T extends string>(value: unknown, expected: T, field: string): T {
  if (value != null && value !== expected) throw new Error(`Configuracao de risco invalida em ${field}.`)
  return expected
}

function policyFrom(version: Row | null): RiskPolicy {
  return {
    active: version?.gate_risco_ativo === true,
    limitPercent: text(version?.limite_exposicao_em_transito_pct),
    inclusiveLimit: version?.limite_inclusivo === true,
    missingPlTreatment: fixedPolicyValue(version?.tratamento_pl_indisponivel, 'BLOQUEAR', 'tratamento_pl_indisponivel'),
    indeterminateTreatment: fixedPolicyValue(version?.tratamento_indeterminada, 'REVISAO_MANUAL', 'tratamento_indeterminada'),
    unmatchedTreatment: fixedPolicyValue(version?.tratamento_sem_match, 'BLOQUEAR', 'tratamento_sem_match'),
    unincorporatedOperationTreatment: fixedPolicyValue(version?.tratamento_operacao_nao_incorporada, 'BLOQUEAR', 'tratamento_operacao_nao_incorporada'),
    partialLiquidationTreatment: fixedPolicyValue(version?.tratamento_liquidacao_parcial, 'SINALIZAR', 'tratamento_liquidacao_parcial'),
  }
}

async function refreshCanonicalSnapshots(input: {
  fundoId: string
  dataOperacional: string
  atorUsuarioId: string
  politicaOperacionalVersaoId?: string | null
  diagnostics?: RiskGateDiagnostics
}) {
  const dates = resolverExpectativasCicloFinanceiro(input.dataOperacional)
  const readCache = createFinancialPipelineReadCache()
  const timings = { matchingMs: 0, reconciliationMs: 0, logisticsMs: 0, exposureMs: 0 }
  let startedAt = Date.now()
  input.diagnostics?.onStageChange?.('matching')
  await executarMatchingFinanceiro({ fundoId: input.fundoId, dataReferencia: dates.ESTOQUE, atorUsuarioId: input.atorUsuarioId, readCache })
  timings.matchingMs = elapsed(startedAt)
  startedAt = Date.now()
  input.diagnostics?.onStageChange?.('reconciliation')
  await executarConciliacaoFinanceira({ fundoId: input.fundoId, dataReferencia: dates.ESTOQUE, atorUsuarioId: input.atorUsuarioId, readCache })
  timings.reconciliationMs = elapsed(startedAt)
  startedAt = Date.now()
  input.diagnostics?.onStageChange?.('logistics')
  await executarPosicaoLogisticaFinanceira({ fundoId: input.fundoId, dataReferencia: dates.ESTOQUE, atorUsuarioId: input.atorUsuarioId })
  timings.logisticsMs = elapsed(startedAt)
  startedAt = Date.now()
  input.diagnostics?.onStageChange?.('exposure')
  const exposure = await executarExposicaoFinanceira({
    fundoId: input.fundoId, dataOperacional: input.dataOperacional, atorUsuarioId: input.atorUsuarioId,
    politicaOperacionalVersaoId: input.politicaOperacionalVersaoId,
  })
  timings.exposureMs = elapsed(startedAt)
  return { exposure, timings }
}

export async function candidateProjection(client: DynamicClient, input: {
  operacaoId: string
  taxaDesconto: number
  fundoId: string
}) : Promise<RiskCandidateProjection> {
  const simulation = await client.rpc('simular_memoria_financeira_operacao', {
    p_operacao_id: input.operacaoId,
    p_taxa_desconto: input.taxaDesconto,
  })
  if (simulation.error || !simulation.data) throw new Error(`Memoria financeira da operacao indisponivel: ${simulation.error?.message || 'sem retorno'}`)
  const memory = simulation.data as Record<string, unknown>
  const items = Array.isArray(memory.itens) ? memory.itens as Array<Record<string, unknown>> : []
  const noteIds = items.map((item) => String(item.nota_fiscal_id)).filter(Boolean)
  const logistics = await classificarLogisticaDasNotas(client, input.fundoId, noteIds)
  let transit = new Decimal(0)
  const indeterminate = new Decimal(0)
  const indeterminateCount = 0
  for (const item of items) {
    const value = item.valor_aquisicao == null ? null : new Decimal(String(item.valor_aquisicao))
    const status = classificarExposicaoLogisticaCandidata(logistics.get(String(item.nota_fiscal_id))?.status)
    if (value && status === 'EM_TRANSITO') transit = transit.plus(value)
  }
  return {
    operationId: input.operacaoId,
    operationUpdatedAt: String(memory.operacao_updated_at),
    currentStatus: String(memory.status),
    acquisitionValue: number(memory.quantidade_valor_ausente) > 0 ? null : String(memory.valor_aquisicao_total),
    transitValue: transit.toFixed(4),
    indeterminateValue: indeterminate.toFixed(4),
    indeterminateCount,
    missingAcquisitionCount: number(memory.quantidade_valor_ausente),
    items: items.map((item) => ({
      notaFiscalId: text(item.nota_fiscal_id),
      parcelaId: text(item.parcela_id),
      valorAquisicao: text(item.valor_aquisicao),
    })).sort((left, right) => `${left.notaFiscalId}:${left.parcelaId}`.localeCompare(`${right.notaFiscalId}:${right.parcelaId}`)),
  }
}

async function resolverFingerprintFinanceiro(client: DynamicClient, input: {
  fundoId: string
  dataOperacional: string
  dates: { ESTOQUE: string }
}) {
  const base = (tipoBase: 'ESTOQUE' | 'AQUISICOES' | 'LIQUIDACOES', dataReferencia: string) => client.from('importacoes_financeiras')
    .select('id,hash_conteudo').eq('fundo_id', input.fundoId).eq('tipo_base', tipoBase)
    .eq('data_referencia', dataReferencia).eq('status', 'PUBLICADA')
    .order('publicada_em', { ascending: false }).limit(1).maybeSingle()
  const [estoque, aquisicoes, liquidacoes, carteiraReferencia] = await Promise.all([
    base('ESTOQUE', input.dates.ESTOQUE), base('AQUISICOES', input.dates.ESTOQUE),
    base('LIQUIDACOES', input.dates.ESTOQUE),
    resolverPlReferencia(client, { fundoId: input.fundoId, dataOperacional: input.dataOperacional }),
  ])
  const pick = (result: { data: Row | null }) => result.data ? { id: result.data.id, hash: text(result.data.hash_conteudo) } : null
  return {
    estoque: pick(estoque),
    aquisicoes: pick(aquisicoes),
    liquidacoes: pick(liquidacoes),
    carteiraReferencia: carteiraReferencia ? {
      id: carteiraReferencia.importacaoId,
      hash: carteiraReferencia.hashConteudo,
      snapshotId: carteiraReferencia.snapshotId,
      dataBase: carteiraReferencia.dataBase,
      regra: carteiraReferencia.regraVersao,
    } : null,
  }
}

async function persist(client: DynamicClient, payload: Record<string, unknown>) {
  const persisted = await client.rpc('persistir_risco_execucao', { p_payload: payload })
  if (persisted.error || !persisted.data) throw new Error(`Nao foi possivel persistir o gate de risco: ${persisted.error?.message || 'sem identificador'}`)
  const [execution, reasons, review] = await Promise.all([
    client.from('risco_execucoes').select('*').eq('id', String(persisted.data)).single(),
    client.from('risco_motivos').select('*').eq('risco_execucao_id', String(persisted.data)).order('created_at'),
    client.from('risco_revisoes').select('*').eq('risco_execucao_id', String(persisted.data)).maybeSingle(),
  ])
  if (execution.error || !execution.data) throw new Error('A avaliacao de risco persistida nao pode ser confirmada.')
  return { execution: execution.data as Row, reasons: (reasons.data || []) as Row[], review: review.data as Row | null }
}

export async function executarGateRisco(input: {
  fundoId: string
  atorUsuarioId: string
  dataOperacional: string
  operacaoId?: string
  taxaDesconto?: number
  origem: 'CENTRAL_RISCO' | 'APROVACAO_OPERACAO'
  diagnostics?: RiskGateDiagnostics
}) {
  const totalStartedAt = Date.now()
  const client = admin()
  const correlationId = randomUUID()
  let exposure: Row | null = null
  let candidate: RiskCandidateProjection | null = null
  let technicalError: string | null = null
  let bootstrapState: EstadoBootstrapFinanceiro | null = null
  let financialFingerprint: Awaited<ReturnType<typeof resolverFingerprintFinanceiro>> | null = null
  let lastStage: RiskGateDiagnosticStage | null = null
  const trackStage = (stage: RiskGateDiagnosticStage | null) => {
    lastStage = stage
    input.diagnostics?.onStageChange?.(stage)
  }
  trackStage('policy')
  const resolved = await resolvePolicy(client, input)
  const policy = policyFrom(resolved.version)
  const timings: RiskGateTimings = {
    matchingMs: 0,
    reconciliationMs: 0,
    logisticsMs: 0,
    exposureMs: 0,
    candidateSimulationMs: 0,
    classificationMs: 0,
    persistenceMs: 0,
    totalMs: 0,
  }

  if (policy.active) {
    try {
      // Resolvidos ANTES de qualquer estagio que possa falhar, e mantidos
      // fora do try/catch de decisao: garantem que a assinatura de
      // idempotencia sempre reflita o estado bootstrap e as bases
      // financeiras materiais (Carteira/PL, ESTOQUE/AQUISICOES/LIQUIDACOES)
      // mesmo quando matching/P2.4/exposicao lancam um erro tecnico -- sem
      // isso, dois erros tecnicos diferentes (causados por inputs
      // materiais diferentes) colidiam na mesma assinatura e reutilizavam
      // uma risco_execucao antiga e desatualizada.
      bootstrapState = await resolverBootstrapFinanceiro(client, input.fundoId)
      const dates = resolverExpectativasCicloFinanceiro(input.dataOperacional)
      financialFingerprint = await resolverFingerprintFinanceiro(client, {
        fundoId: input.fundoId,
        dataOperacional: input.dataOperacional,
        dates,
      })

      const operationId = input.operacaoId
      const candidateTask = operationId
        ? (async () => {
            if (input.taxaDesconto == null) throw new Error('Taxa da operacao obrigatoria para o gate de aprovacao.')
            trackStage('candidateSimulation')
            const simulationStartedAt = Date.now()
            const projection = await candidateProjection(client, { operacaoId: operationId, taxaDesconto: input.taxaDesconto, fundoId: input.fundoId })
            timings.candidateSimulationMs = elapsed(simulationStartedAt)
            return projection
          })()
        : Promise.resolve(null)

      // Promise.allSettled (nao Promise.all): uma falha isolada em um dos
      // dois ramos nao deve descartar o resultado real do outro -- ambos
      // sao inputs materiais independentes da assinatura, mesmo quando o
      // resultado final da decisao permanece BLOQUEADO por fail-closed.
      // Escopo operacao: usa exatamente o snapshot de politica congelado na
      // operacao (resolved.version), o mesmo que a classificacao do gate ja
      // usa -- nunca a resolucao padrao=true do fundo, que pode ser uma
      // politica diferente da que realmente governa esta operacao. Escopo
      // fundo/Central de Risco (sem operacaoId): omitido, preserva a
      // resolucao vigente e independente de executarExposicaoFinanceira.
      const [refreshedResult, candidateResult] = await withRiskGateTimeout(Promise.allSettled([
        refreshCanonicalSnapshots({
          ...input, diagnostics: { onStageChange: trackStage },
          politicaOperacionalVersaoId: operationId ? resolved.version?.id || null : null,
        }),
        candidateTask,
      ]))

      if (candidateResult.status === 'fulfilled') candidate = candidateResult.value
      if (refreshedResult.status === 'fulfilled') {
        Object.assign(timings, refreshedResult.value.timings)
        trackStage('exposure')
        const loaded = await client.from('exposicao_execucoes').select('*').eq('id', refreshedResult.value.exposure.execucaoId).single()
        if (loaded.error || !loaded.data) throw new Error('Snapshot P2.5 atualizado nao encontrado.')
        exposure = loaded.data as Row
      }
      if (refreshedResult.status === 'rejected') throw refreshedResult.reason
      if (candidateResult.status === 'rejected') throw candidateResult.reason
    } catch (error) {
      technicalError = error instanceof Error ? error.message : 'Falha tecnica nao identificada.'
    }
  }

  const technicalErrorStage = technicalError ? lastStage : null
  trackStage('classification')
  const classificationStartedAt = Date.now()
  const classification = classificarGateRisco({
    policy,
    exposureStatus: technicalError ? 'AVALIACAO_RISCO_INDISPONIVEL' : String(exposure?.status || 'NAO_APLICAVEL'),
    currentPercent: text(exposure?.percentual_exposicao),
    currentExposureValue: text(exposure?.exposicao_em_transito_total),
    netAssetValueD2: text(exposure?.patrimonio_liquido_d2),
    indeterminateCount: number(exposure?.quantidade_indeterminada),
    indeterminateValue: text(exposure?.valor_indeterminado),
    unmatchedCount: number(exposure?.quantidade_sem_match),
    unmatchedValue: text(exposure?.valor_sem_match),
    missingAcquisitionCount: number(exposure?.quantidade_valor_aquisicao_ausente),
    unincorporatedOperationCount: number(exposure?.quantidade_nao_incorporada),
    unincorporatedOperationValue: text(exposure?.operacoes_nao_incorporadas_valor),
    hasPartialLiquidation: Array.isArray(exposure?.flags_qualidade) && exposure.flags_qualidade.includes('TEM_LIQUIDACAO_PARCIAL'),
    candidate,
  })
  timings.classificationMs = elapsed(classificationStartedAt)

  const signature = criarAssinaturaRisco({
    rule: RISK_GATE_RULE_VERSION,
    fund: input.fundoId,
    operation: input.operacaoId || null,
    operationUpdatedAt: candidate?.operationUpdatedAt || resolved.operation?.updated_at || null,
    rate: input.taxaDesconto ?? null,
    policy: resolved.version?.id || null,
    bootstrap: bootstrapState,
    financialFingerprint,
    exposure: exposure?.id || null,
    exposureSignature: exposure?.assinatura_execucao || null,
    candidate,
    classification,
  })
  const payload = {
    fundo_id: input.fundoId,
    operacao_id: input.operacaoId || null,
    escopo: input.operacaoId ? 'OPERACAO' : 'FUNDO',
    origem: input.origem,
    regra_versao: RISK_GATE_RULE_VERSION,
    politica_operacional_versao_id: resolved.version?.id || null,
    exposicao_execucao_id: exposure?.id || null,
    data_operacional: input.dataOperacional,
    logistica_as_of: exposure?.logistica_as_of || null,
    overlay_as_of: exposure?.overlay_as_of || new Date().toISOString(),
    operacao_updated_at_snapshot: candidate?.operationUpdatedAt || resolved.operation?.updated_at || null,
    taxa_desconto_snapshot: input.taxaDesconto ?? null,
    aplicavel: classification.applicable,
    status_tecnico: classification.technicalStatus,
    decisao: classification.decision,
    limite_pct: policy.limitPercent,
    patrimonio_liquido_d2: exposure?.patrimonio_liquido_d2 ?? null,
    exposicao_atual_valor: exposure?.exposicao_em_transito_total ?? null,
    exposicao_atual_pct: classification.currentPercent,
    operacao_valor_aquisicao: candidate?.acquisitionValue ?? null,
    operacao_valor_em_transito: candidate?.transitValue ?? null,
    operacao_valor_indeterminado: candidate?.indeterminateValue ?? null,
    exposicao_projetada_valor: classification.projectedExposureValue,
    exposicao_projetada_pct: classification.projectedPercent,
    quantidade_indeterminada: number(exposure?.quantidade_indeterminada) + (candidate?.indeterminateCount || 0),
    quantidade_sem_match: number(exposure?.quantidade_sem_match),
    quantidade_valor_aquisicao_ausente: number(exposure?.quantidade_valor_aquisicao_ausente) + (candidate?.missingAcquisitionCount || 0),
    quantidade_operacao_nao_incorporada: number(exposure?.quantidade_nao_incorporada),
    liquidacao_parcial_presente: Array.isArray(exposure?.flags_qualidade) && exposure.flags_qualidade.includes('TEM_LIQUIDACAO_PARCIAL'),
    assinatura_inputs: signature,
    correlation_id: correlationId,
    criado_por: input.atorUsuarioId,
    detalhes: {
      technical_error: technicalError, technical_error_stage: technicalErrorStage, candidate, source: 'P2.3-P2.4-P2.5',
      bootstrap: bootstrapState, financial_fingerprint: financialFingerprint,
    },
    motivos: classification.reasons.map((reason) => ({
      codigo: reason.code,
      severidade: reason.severity,
      valor_numerico: reason.numericValue ?? null,
      valor_monetario: reason.monetaryValue ?? null,
      quantidade: reason.quantity ?? null,
      detalhes: reason.details || {},
    })),
  }
  trackStage('persistence')
  const persistenceStartedAt = Date.now()
  const persisted = await persist(client, payload)
  timings.persistenceMs = elapsed(persistenceStartedAt)
  timings.totalMs = elapsed(totalStartedAt)
  trackStage(null)
  return { ...persisted, classification, signature, correlationId, timings }
}
