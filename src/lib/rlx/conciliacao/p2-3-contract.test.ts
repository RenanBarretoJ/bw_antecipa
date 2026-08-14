import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RLX_MATCH_METHODS, RLX_RECONCILIATION_STATUSES } from './types'

const root = process.cwd()
const migration = readFileSync(resolve(root, 'supabase/migrations/20260814141629_p2_3_matching_conciliacao_rlx.sql'), 'utf8')
const expectedMatching = JSON.parse(readFileSync(resolve(root, 'scripts/homologacao/rlx-golden/fixtures/expected/expected-matching.json'), 'utf8'))
const expectedReconciliation = JSON.parse(readFileSync(resolve(root, 'scripts/homologacao/rlx-golden/fixtures/expected/expected-reconciliation.json'), 'utf8'))

describe('contrato arquitetural P2.3', () => {
  it('nao acopla matching ao canonico imutavel P2.2', () => {
    expect(migration).not.toMatch(/UPDATE\s+public[.]rlx_(estoque_posicoes|aquisicao_movimentos|liquidacao_movimentos)/i)
    expect(migration).toContain('CREATE TABLE public.rlx_titulo_nf_vinculos')
    expect(migration).toContain('CREATE TABLE public.rlx_conciliacao_resultados')
  })

  it('preserva o contrato textual BIGINT e o isolamento cross-fund', () => {
    expect(expectedMatching.bigIntegerContract).toEqual({ type: 'string', sample: '900719925474099312345' })
    expect(expectedMatching.crossFundCollision.expected).toBe('DOIS_MATCHES_INDEPENDENTES_POR_FUNDO')
    expect(migration).toContain('(fundo_id, provedor, tipo_chave, valor_normalizado)')
  })

  it('declara todos os metodos e status exigidos pelos expected imutaveis', () => {
    const methods = new Set(expectedMatching.cases.map((item: { expectedMethod: string }) => item.expectedMethod))
    for (const method of methods) expect(RLX_MATCH_METHODS).toContain(method)
    const statuses = new Set(expectedReconciliation.cases.map((item: { expected: string }) => item.expected))
    for (const status of statuses) expect(RLX_RECONCILIATION_STATUSES).toContain(status)
  })

  it('restringe persistencia automatica ao service_role e habilita RLS', () => {
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.rlx_persistir_matching_execucao(jsonb) TO service_role')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.rlx_persistir_conciliacao_execucao(jsonb) TO service_role')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).not.toMatch(/GRANT\s+[\s\S]*?\sTO\s+(?:PUBLIC|anon)\s*;/i)
  })
})
