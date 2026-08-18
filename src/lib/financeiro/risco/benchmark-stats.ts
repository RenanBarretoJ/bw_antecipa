export type BenchmarkStats = {
  count: number
  min: number
  p25: number
  p50: number
  p75: number
  p90: number
  p95: number
  max: number
  mean: number
  standardDeviation: number
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function percentile(values: number[], ratio: number) {
  if (values.length === 0) throw new Error('Nao e possivel calcular percentil sem amostras.')
  if (ratio < 0 || ratio > 1) throw new Error('Percentil deve estar entre zero e um.')
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
}

export function calculateBenchmarkStats(values: number[]): BenchmarkStats {
  if (values.length === 0) throw new Error('Nao e possivel calcular estatisticas sem amostras.')
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length
  return {
    count: values.length,
    min: Math.min(...values),
    p25: percentile(values, 0.25),
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
    mean: round(mean),
    standardDeviation: round(Math.sqrt(variance)),
  }
}
