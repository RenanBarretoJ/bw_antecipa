import { performance } from 'node:perf_hooks'
import { calcularAgregadosPosicao, calcularExposicao, classificarOverlayCandidate } from '../../../../src/lib/financeiro/exposicao/calculo'

const base = Array.from({ length: 10_000 }, (_, index) => ({
  statusVinculo: index % 10 === 0 ? 'SEM_MATCH_FINANCEIRO_NF' as const : 'MATCHED_FINANCEIRO_NF' as const,
  statusLogistico: index % 10 === 0 ? null : index % 3 === 0 ? 'ENTREGUE' as const : index % 3 === 1 ? 'EM_TRANSITO' as const : 'INDETERMINADA' as const,
  valorAquisicao: index % 97 === 0 ? null : `${10_000 + index}.1234`,
}))
const overlay = Array.from({ length: 1_000 }, (_, index) => classificarOverlayCandidate({
  operacaoId: `op-${index}`, notaFiscalId: `nf-${index}`, valorAquisicao: `${20_000 + index}.4321`,
  statusLogistico: index % 3 === 0 ? 'EM_TRANSITO' : index % 3 === 1 ? 'ENTREGUE' : 'INDETERMINADA',
  jaIncorporadoEstoque: index % 17 === 0, operacaoEconomicaEm: '2026-08-10T12:00:00Z', dataOperacional: '2026-08-10',
}))
const before = process.memoryUsage().heapUsed
const started = performance.now()
const aggregates = calcularAgregadosPosicao(base)
const result = calcularExposicao({ posicaoEmTransito: aggregates.valorEmTransito, overlay, patrimonioLiquido: '500000000', limite: '40' })
const elapsed = performance.now() - started
const after = process.memoryUsage().heapUsed
console.log(JSON.stringify({ positions: base.length, overlay: overlay.length, elapsed_ms: Number(elapsed.toFixed(2)), heap_delta_mb: Number(((after-before)/1024/1024).toFixed(2)), result }, null, 2))
