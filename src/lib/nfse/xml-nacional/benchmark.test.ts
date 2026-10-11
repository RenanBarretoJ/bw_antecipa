import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFiscalFile } from '@/lib/fiscal-intake/parse.server'
import { benchmarkNationalCorpus } from './benchmark'

describe('benchmark somente leitura do XML Nacional', () => {
  it('compara o dispatcher atual com expectativas independentes sem persistir', async () => {
    const report = await benchmarkNationalCorpus(parseFiscalFile)
    if (process.env.BW_NFSE_WRITE_BENCHMARK === 'true') {
      writeFileSync('docs/analises/nfse-e1-e2-2026-10-09.benchmark.json', JSON.stringify(report, null, 2)+'\n', 'utf8')
      console.log(JSON.stringify(report.resumo))
    }
    expect(report.resumo.documentos).toBeGreaterThanOrEqual(12)
    expect(report.resumo.divergencias).toBe(0)
    expect(report.resumo.baseline_erros).toBe(report.resumo.documentos)
    expect(report.resumo.adaptador_reconhecidos).toBe(report.resumo.documentos)
    expect(report.acuracia_fiscal_real).toBeNull()
  })
})
