import { performance } from 'node:perf_hooks'
import { calcularAgregadosPosicao, calcularExposicao, classificarOverlayCandidate } from '../../../../src/lib/financeiro/exposicao/calculo'
import { classificarGateRisco } from '../../../../src/lib/financeiro/risco/classificador'

const volumes = [
  { positions: 10_000, overlay: 1_000 },
  { positions: 25_000, overlay: 2_500 },
  { positions: 50_000, overlay: 5_000 },
]

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
}

function measure(run: () => void) {
  const before = process.memoryUsage().heapUsed
  const started = performance.now()
  run()
  return { elapsedMs: performance.now() - started, heapBefore: before, heapAfter: process.memoryUsage().heapUsed }
}

const results = volumes.map((volume) => {
  const positions = Array.from({ length: volume.positions }, (_, index) => ({
    statusVinculo: index % 17 === 0 ? 'SEM_MATCH_FINANCEIRO_NF' as const : 'MATCHED_FINANCEIRO_NF' as const,
    statusLogistico: index % 17 === 0 ? null : index % 3 === 0 ? 'ENTREGUE' as const : index % 3 === 1 ? 'EM_TRANSITO' as const : 'INDETERMINADA' as const,
    valorAquisicao: index % 101 === 0 ? null : `${10_000 + index}.1234`,
  }))
  const overlay = Array.from({ length: volume.overlay }, (_, index) => classificarOverlayCandidate({
    operacaoId: `p261-op-${index}`,
    notaFiscalId: `p261-nf-${index}`,
    valorAquisicao: `${20_000 + index}.4321`,
    statusLogistico: index % 3 === 0 ? 'EM_TRANSITO' : index % 3 === 1 ? 'ENTREGUE' : 'INDETERMINADA',
    jaIncorporadoEstoque: index % 19 === 0,
    operacaoEconomicaEm: '2026-08-10T12:00:00Z',
    dataOperacional: '2026-08-10',
  }))
  const samples = Array.from({ length: 7 }, () => {
    let decision: string | null = null
    const measured = measure(() => {
      const aggregates = calcularAgregadosPosicao(positions)
      const exposure = calcularExposicao({ posicaoEmTransito: aggregates.valorEmTransito, overlay, patrimonioLiquido: '500000000', limite: '40' })
      const classification = classificarGateRisco({
        policy: { active: true, inclusiveLimit: true, limitPercent: '40', missingPlTreatment: 'BLOQUEAR', indeterminateTreatment: 'REVISAO_MANUAL', unmatchedTreatment: 'BLOQUEAR', unincorporatedOperationTreatment: 'BLOQUEAR', partialLiquidationTreatment: 'SINALIZAR' },
        exposureStatus: 'CALCULADA',
        netAssetValueD2: '500000000',
        currentExposureValue: exposure.exposicaoEmTransitoTotal,
        currentPercent: exposure.percentualExposicao,
        unmatchedCount: aggregates.quantidadeSemMatch,
        unmatchedValue: aggregates.valorSemMatch,
        indeterminateCount: aggregates.quantidadeIndeterminada,
        indeterminateValue: aggregates.valorIndeterminado,
        missingAcquisitionCount: aggregates.valorAusente,
        unincorporatedOperationCount: overlay.filter((item) => item.motivo === 'OPERACAO_NAO_INCORPORADA').length,
        unincorporatedOperationValue: exposure.operacoesNaoIncorporadasValor,
        hasPartialLiquidation: false,
      })
      decision = classification.decision
    })
    return { ...measured, decision }
  })
  const elapsed = samples.map((item) => item.elapsedMs)
  return {
    ...volume,
    samples: samples.length,
    p50_ms: Number(percentile(elapsed, 0.5).toFixed(2)),
    p95_ms: Number(percentile(elapsed, 0.95).toFixed(2)),
    max_ms: Number(Math.max(...elapsed).toFixed(2)),
    heap_before_mb: Number((samples[0].heapBefore / 1024 / 1024).toFixed(2)),
    heap_after_mb: Number((samples.at(-1)!.heapAfter / 1024 / 1024).toFixed(2)),
    heap_delta_mb: Number(((samples.at(-1)!.heapAfter - samples[0].heapBefore) / 1024 / 1024).toFixed(2)),
    decisions: [...new Set(samples.map((item) => item.decision))],
  }
})

console.log(JSON.stringify({ schema: 'bw-antecipa-p2-6-1-computational-benchmark-v1', node: process.version, results }, null, 2))
