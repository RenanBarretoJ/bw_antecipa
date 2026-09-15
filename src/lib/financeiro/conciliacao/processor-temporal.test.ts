import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('referencia temporal do processor de conciliacao', () => {
  it('resolve Estoque D-2 pelo calendario canonico, sem subtracao civil dispersa', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/financeiro/conciliacao/processor.server.ts'), 'utf8')
    expect(source).toContain("import { diaUtilAnterior } from '@/lib/comunicacoes/calendario'")
    expect(source).toContain('const d2Date = diaUtilAnterior(input.dataReferencia)')
    expect(source).not.toContain('function previousDate')
    expect(source).not.toContain('setUTCDate')
  })
})
