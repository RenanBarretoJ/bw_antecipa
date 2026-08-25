import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260825130000_p0_vortx_vrs2_adapter_capabilities.sql'),
  'utf8',
)

describe('contrato da migration P0 (Vortx VRS 2.0 -- adapter orientado por capabilities)', () => {
  it('e transacional', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
  })

  it('depende da migration de fundacao da Vortx (guard defensivo no topo)', () => {
    expect(migration).toContain("to_regclass('public.integracoes_vortx_vrs_credenciais')")
  })

  it('libera vortx_vrs para CESSAO_ENVIO/ESTOQUE/AQUISICOES/LIQUIDACOES, nunca CARTEIRA', () => {
    const funcao = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION private.integracao_adapter_capability_suportada'))
    expect(funcao).toContain("WHEN 'vortx_vrs' THEN p_capability IN ('CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES')")
    expect(funcao).not.toMatch(/vortx_vrs[\s\S]{0,80}CARTEIRA/)
  })

  it('preserva a capability existente do adapter Sinqia (nunca remove um handler ja em uso)', () => {
    expect(migration).toContain("WHEN 'sinqia_portal_fidc' THEN p_capability = 'CESSAO_ENVIO'")
  })

  it('mantem o fallback fail-closed para adapters desconhecidos', () => {
    expect(migration).toContain('ELSE false')
  })

  it('nega execucao direta para authenticated/anon (funcao e so um espelho interno)', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION private.integracao_adapter_capability_suportada(text, text)')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated;')
  })
})
