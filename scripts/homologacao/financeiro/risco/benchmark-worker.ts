import { createClient } from '@supabase/supabase-js'
import { executarGateRisco, type RiskGateTimings } from '../../../../src/lib/financeiro/risco/processor.server'
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

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Credenciais Supabase server-side ausentes.')
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const dataset = buildGoldenV2()
  const operationIds = [dataset.riskCandidateOperation.id, ...dataset.operations.map((item) => item.id)]
  const { data: operationStates, error: operationError } = await client.from('operacoes').select('id,status').in('id', operationIds)
  if (operationError) throw new Error(`Operacoes QA V2 nao puderam ser consultadas: ${operationError.message}`)
  const eligibleId = operationStates?.find((item) => ['solicitada', 'em_analise'].includes(String(item.status)))?.id
  const operation = [dataset.riskCandidateOperation, ...dataset.operations].find((item) => item.id === eligibleId)
  if (!operation) throw new Error(`Nenhuma operacao Golden V2 elegivel para o benchmark do gate por operacao. Estados: ${JSON.stringify(operationStates || [])}`)
  const { data: actor, error } = await client.from('cedentes').select('user_id').eq('id', operation.note.cedent.id).single()
  if (error || !actor?.user_id) throw new Error(`Ator QA V2 nao encontrado: ${error?.message || 'retorno vazio'}`)

  const samples: RiskGateTimings[] = []
  const outcomes: Array<{ technicalStatus: string; decision: string | null; details: Record<string, unknown> }> = []
  for (let index = 0; index < 5; index += 1) {
    const result = await executarGateRisco({
      fundoId: operation.note.fund.id,
      operacaoId: operation.id,
      taxaDesconto: operation.rate,
      dataOperacional: dataset.baseDate,
      atorUsuarioId: actor.user_id,
      origem: 'APROVACAO_OPERACAO',
    })
    samples.push(result.timings)
    outcomes.push({
      technicalStatus: result.classification.technicalStatus,
      decision: result.classification.decision,
      details: result.execution.detalhes as Record<string, unknown>,
    })
  }

  const summary = Object.fromEntries(metrics.map((metric) => {
    const values = samples.map((sample) => sample[metric])
    return [metric, {
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      max: Math.max(...values),
    }]
  }))
  console.log(JSON.stringify({
    projectRef: new URL(url).hostname.split('.')[0],
    samples: samples.length,
    operationId: operation.id,
    outcomes,
    measurements: summary,
  }, null, 2))
}

main().catch((error) => {
  console.error(`Benchmark P2.6 falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
