import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// O modulo e executado diretamente por Node nos scripts administrativos.
import {
  PERF9A_USERS,
  formatCnpj,
  generateTotp,
  generateValidCnpj,
} from '../../../scripts/perf9a/dataset.mjs'

describe('massa PERF9A', () => {
  it('mantem usuarios representativos sem credenciais versionadas', () => {
    expect(PERF9A_USERS).toHaveLength(20)
    expect(PERF9A_USERS.every((user: Record<string, unknown>) => !('password' in user) && !('secret' in user))).toBe(true)
  })

  it('gera CNPJs validos, distintos e formataveis', () => {
    const values = Array.from({ length: 200 }, (_, index) => generateValidCnpj(index + 1))
    expect(new Set(values).size).toBe(values.length)
    expect(values.every((value: string) => /^\d{14}$/.test(value))).toBe(true)
    expect(formatCnpj(values[0])).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/)
  })

  it('gera TOTP conhecido do RFC 6238 com SHA-1 truncado para seis digitos', () => {
    expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082')
  })

  it('mantem cleanup destrutivo opt-in e verificacao RLS com AAL2', () => {
    const cleanup = readFileSync(resolve(process.cwd(), 'scripts/perf9a/cleanup-homolog.mjs'), 'utf8')
    const verifier = readFileSync(resolve(process.cwd(), 'scripts/perf9a/verify-homolog.mjs'), 'utf8')

    expect(cleanup).toContain("const execute = args.execute === true")
    expect(cleanup).toContain('DRY-RUN')
    expect(cleanup).toContain('assertExplicitConfirmation')
    expect(verifier).toContain("after.currentLevel !== 'aal2'")
    expect(verifier).toContain('acesso cruzado entre fundos')
    expect(verifier).toContain('acesso cruzado entre consultores')
  })
})
