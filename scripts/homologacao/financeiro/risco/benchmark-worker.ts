import { createClient } from '@supabase/supabase-js'
import { executarGateRisco, type RiskGateTimings } from '../../../../src/lib/financeiro/risco/processor.server'
import { calculateBenchmarkStats } from '../../../../src/lib/financeiro/risco/benchmark-stats'
import { buildGoldenV2 } from '../../rlx-golden-v2/scenario-definitions.mjs'

type Metric = keyof RiskGateTimings
const metrics: Metric[] = [
  'matchingMs',
  'reconciliationMs',
  'logisticsMs',
  'exposureMs',
  'candidateSimulationMs',
  'classificationMs',
  'persistenceMs',
  'totalMs',
]

type RequestTrace = {
  total: number
  rpc: number
  rest: number
  other: number
  methods: Record<string, number>
  byStage: Record<string, { total: number; rpc: number; rest: number; other: number }>
}

function emptyTrace(): RequestTrace {
  return { total: 0, rpc: 0, rest: 0, other: 0, methods: {}, byStage: {} }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Credenciais Supabase server-side ausentes.')
  const projectRef = new URL(url).hostname.split('.')[0]
  if (projectRef !== 'fhgkmggthxikfpogrvaa') throw new Error('Benchmark P2.6.9 bloqueado fora do projeto homolog autorizado.')
  const warmups = Number(process.env.BW_BENCHMARK_WARMUPS || 5)
  const measuredRuns = Number(process.env.BW_BENCHMARK_RUNS || 20)
  const batch = String(process.env.BW_BENCHMARK_BATCH || 'before')
  const profileOnly = process.env.BW_BENCHMARK_PROFILE_ONLY === '1'
  const requestedOperationId = String(process.env.BW_BENCHMARK_OPERATION_ID || '')
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const dataset = buildGoldenV2()
  const operationIds = [dataset.riskCandidateOperation.id, ...dataset.operations.map((item) => item.id)]
  const { data: operationStates, error: operationError } = await client.from('operacoes').select('id,status').in('id', operationIds)
  if (operationError) throw new Error(`Operacoes QA V2 nao puderam ser consultadas: ${operationError.message}`)
  const eligibleId = requestedOperationId || operationStates?.find((item) => ['solicitada', 'em_analise'].includes(String(item.status)))?.id
  const operation = [dataset.riskCandidateOperation, ...dataset.operations].find((item) => item.id === eligibleId)
  if (!operation) throw new Error(`Nenhuma operacao Golden V2 elegivel para o benchmark do gate por operacao. Estados: ${JSON.stringify(operationStates || [])}`)
  const { data: actor, error } = await client.from('cedentes').select('user_id').eq('id', operation.note.cedent.id).single()
  if (error || !actor?.user_id) throw new Error(`Ator QA V2 nao encontrado: ${error?.message || 'retorno vazio'}`)

  const nativeFetch = globalThis.fetch.bind(globalThis)
  let activeTrace: RequestTrace | null = null
  let activeStage: string | null = null
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (activeTrace) {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const path = new URL(target).pathname
      const method = String(init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET') || 'GET').toUpperCase()
      activeTrace.total += 1
      activeTrace.methods[method] = (activeTrace.methods[method] || 0) + 1
      if (path.includes('/rest/v1/rpc/')) activeTrace.rpc += 1
      else if (path.includes('/rest/v1/')) activeTrace.rest += 1
      else activeTrace.other += 1
      const stage = activeStage || 'unattributed'
      const stageTrace = activeTrace.byStage[stage] ||= { total: 0, rpc: 0, rest: 0, other: 0 }
      stageTrace.total += 1
      if (path.includes('/rest/v1/rpc/')) stageTrace.rpc += 1
      else if (path.includes('/rest/v1/')) stageTrace.rest += 1
      else stageTrace.other += 1
    }
    return nativeFetch(input, init)
  }

  const execute = async () => {
    activeTrace = emptyTrace()
    try {
      const result = await executarGateRisco({
        fundoId: operation.note.fund.id,
        operacaoId: operation.id,
        taxaDesconto: operation.rate,
        dataOperacional: dataset.baseDate,
        atorUsuarioId: actor.user_id,
        origem: 'APROVACAO_OPERACAO',
        diagnostics: { onStageChange: (stage) => { activeStage = stage } },
      })
      return { result, requests: activeTrace }
    } finally {
      activeTrace = null
      activeStage = null
    }
  }

  for (let index = 0; index < warmups; index += 1) await execute()

  const samples: Array<{
    run: number
    timings: RiskGateTimings | null
    requests: RequestTrace
    technical_status: string | null
    decision: string | null
    reason_codes: string[]
    error: string | null
  }> = []
  for (let index = 0; index < measuredRuns; index += 1) {
    try {
      const measured = await execute()
      samples.push({
        run: index + 1,
        timings: measured.result.timings,
        requests: measured.requests,
        technical_status: measured.result.classification.technicalStatus,
        decision: measured.result.classification.decision,
        reason_codes: measured.result.classification.reasons.map((reason) => reason.code),
        error: null,
      })
    } catch (runError) {
      samples.push({
        run: index + 1,
        timings: null,
        requests: activeTrace || emptyTrace(),
        technical_status: null,
        decision: null,
        reason_codes: [],
        error: runError instanceof Error ? runError.message : String(runError),
      })
    }
  }

  const successful = samples.filter((sample): sample is typeof sample & { timings: RiskGateTimings } => sample.timings != null)
  const stats = Object.fromEntries(metrics.map((metric) => [metric, calculateBenchmarkStats(successful.map((sample) => sample.timings[metric]))]))
  const requestStats = {
    total: calculateBenchmarkStats(successful.map((sample) => sample.requests.total)),
    rpc: calculateBenchmarkStats(successful.map((sample) => sample.requests.rpc)),
    rest: calculateBenchmarkStats(successful.map((sample) => sample.requests.rest)),
    other: calculateBenchmarkStats(successful.map((sample) => sample.requests.other)),
  }
  const outcomeSignatures = new Set(successful.map((sample) => JSON.stringify({
    technical_status: sample.technical_status,
    decision: sample.decision,
    reason_codes: sample.reason_codes,
  })))

  console.log(JSON.stringify({
    schema: 'bw-antecipa-p2-6-9-benchmark-batch-v2',
    generated_at: new Date().toISOString(),
    batch,
    profile_only: profileOnly,
    environment: 'homolog',
    project_ref: projectRef,
    production_touched: false,
    credential_rotation_required: false,
    credential_rotation_completed: true,
    administrative_credential_used: true,
    workload: {
      dataset: 'RLX_GOLDEN_V2',
      data_operacional: dataset.baseDate,
      benchmark_case_id: `RLX_GOLDEN_V2:${operation.note.fund.id}:${operation.id}:${dataset.baseDate}`,
      fundo_qa_id: operation.note.fund.id,
      operacao_qa_id: operation.id,
      quantidade_nfs_fixture: dataset.notes.length,
      quantidade_nfs_fundo_qa: dataset.notes.filter((note) => note.fund.id === operation.note.fund.id).length,
      quantidade_operacoes_fixture: dataset.operations.length,
      quantidade_matching_fixture: dataset.matching.length,
      quantidade_conciliacao_fixture: dataset.reconciliation.length,
    },
    protocol: {
      warmups_executed: warmups,
      measured_runs: measuredRuns,
      outliers_removed: 0,
      percentile_method: 'nearest-rank',
    },
    samples,
    stats,
    request_stats: requestStats,
    request_profile_by_stage: successful.map((sample) => sample.requests.byStage),
    stability: {
      successful_runs: successful.length,
      errors: samples.filter((sample) => sample.error != null).length,
      timeouts: samples.filter((sample) => sample.error?.toLowerCase().includes('timeout')).length,
      technical_errors: successful.filter((sample) => sample.technical_status === 'AVALIACAO_RISCO_INDISPONIVEL').length,
      semantic_outcomes_distinct: outcomeSignatures.size,
      semantic_outcome: successful[0] ? {
        technical_status: successful[0].technical_status,
        decision: successful[0].decision,
        reason_codes: successful[0].reason_codes,
      } : null,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(`Benchmark P2.6 falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
