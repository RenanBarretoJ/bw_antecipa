import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260814220000_p2_5_1_generalizacao_dominio_financeiro.sql',
)

describe('estrutura generica do dominio financeiro', () => {
  it('nao mantem o modulo estrutural legado em src/lib/rlx', () => {
    expect(existsSync(resolve(process.cwd(), 'src/lib/rlx'))).toBe(false)
  })

  it('generaliza objetos existentes sem criar novas estruturas rlx_', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration).toContain("('rlx_importacoes_financeiras', 'importacoes_financeiras', 'r')")
    expect(migration).toContain("('rlx_exposicao_execucoes', 'exposicao_execucoes', 'r')")
    expect(migration).toContain("('public', 'rlx_persistir_matching_execucao', 'persistir_matching_execucao')")
    expect(migration).not.toMatch(/create\s+(?:or\s+replace\s+)?table\s+(?:public\.)?rlx_/i)
    expect(migration).not.toMatch(/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?rlx_/i)
  })

  it('preserva as versoes historicas das regras financeiras', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration).toContain('Versoes de regra RLX_*')
    expect(migration).not.toContain("('RLX_MATCH_V1',")
    expect(migration).not.toContain("('RLX_RECON_V1',")
    expect(migration).not.toContain("('RLX_LOGISTICA_V1',")
    expect(migration).not.toContain("('RLX_EXPOSICAO_V1',")
  })
})
