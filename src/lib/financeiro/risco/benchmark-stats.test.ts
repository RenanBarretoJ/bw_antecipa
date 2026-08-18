import { describe, expect, it } from 'vitest'
import { calculateBenchmarkStats, percentile } from './benchmark-stats'

describe('benchmark stats', () => {
  it('calcula percentis pelo nearest-rank sem arredondar o gate', () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1)
    expect(percentile(values, 0.95)).toBe(19)
    expect(calculateBenchmarkStats(values)).toMatchObject({
      count: 20,
      min: 1,
      p25: 5,
      p50: 10,
      p75: 15,
      p90: 18,
      p95: 19,
      max: 20,
      mean: 10.5,
    })
  })

  it('rejeita conjuntos vazios', () => {
    expect(() => calculateBenchmarkStats([])).toThrow('sem amostras')
  })
})
