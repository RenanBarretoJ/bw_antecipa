import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260813210000_p2_2_1_integracoes_capabilities.sql'), 'utf8')
const portalRuntime = readFileSync(resolve(process.cwd(), 'src/lib/portal-fidc/integracao.ts'), 'utf8')
const ingestion = readFileSync(resolve(process.cwd(), 'src/lib/rlx/ingestao/ingestao.server.ts'), 'utf8')

describe('P2.2.1 - schema de integracoes por capability', () => {
  it('normaliza capabilities por versao e limita uma fonte ativa por contexto', () => {
    expect(migration).toContain('CREATE TABLE public.integracao_fundo_versao_capacidades')
    expect(migration).toContain('UNIQUE (integracao_fundo_versao_id, capability)')
    expect(migration).toContain('CREATE UNIQUE INDEX uq_integracao_capability_fonte_ativa')
    expect(migration).toContain('(fundo_id, ambiente, capability)')
    expect(migration).toContain('WHERE disponivel_desde IS NOT NULL AND disponivel_ate IS NULL')
  })

  it('publica com locks, transferencia atomica e sem fallback', () => {
    const resolver = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.resolver_integracao_por_capability'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.resolver_integracao_por_capability'),
    )
    expect(migration).toContain("hashtextextended(p_fundo_id::text || ':' || v_versao.ambiente || ':' || v_capability, 0)")
    expect(migration).toContain("private.sa3_auditar('CAPABILITY_FONTE_SUBSTITUIDA'")
    expect(migration).toContain('integracao_adapter_capability_suportada')
    expect(resolver).not.toMatch(/ORDER BY|LIMIT\s+1/i)
  })

  it('faz backfill Sinqia somente para CESSAO_ENVIO', () => {
    const backfill = migration.slice(
      migration.indexOf('-- Backfill apenas da capacidade'),
      migration.indexOf('ALTER TABLE public.rlx_importacoes_financeiras'),
    )
    expect(backfill).toContain("'CESSAO_ENVIO'")
    expect(backfill).not.toMatch(/'ESTOQUE'|'AQUISICOES'|'LIQUIDACOES'|'CARTEIRA'/)
    expect(backfill).toContain("i.provider_key = 'SINQIA'")
    expect(backfill).toContain("i.system_name = 'Portal FIDC'")
  })

  it('preserva CNAB separado e liga importacao automatica a versao tecnica', () => {
    expect(migration).toContain('rlx_importacoes_financeiras.integracao_fundo_versao_id')
    expect(migration).toContain("IF NEW.origem <> 'CRON'")
    expect(migration).not.toMatch(/ALTER TABLE public\.configuracao_cnab_versoes[\s\S]*capabilit/i)
    expect(ingestion).toContain("input.origem === 'CRON' && !input.integracaoFundoVersaoId")
    expect(ingestion).toContain('integracao_fundo_versao_id: input.integracaoFundoVersaoId ?? null')
  })

  it('mantem resolver e tabela restritos ao service role', () => {
    expect(migration).toContain('REVOKE ALL ON TABLE public.integracao_fundo_versao_capacidades FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT ALL ON TABLE public.integracao_fundo_versao_capacidades TO service_role')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.resolver_integracao_por_capability(uuid, text, text)')
    expect(migration).toContain('TO service_role')
  })

  it('remove o hardcode de provider da resolucao operacional de cessao', () => {
    expect(portalRuntime).toContain("capability: 'CESSAO_ENVIO'")
    expect(portalRuntime).toContain("version.adapterKey !== 'sinqia_portal_fidc'")
    expect(portalRuntime).not.toContain(".eq('provedor', PORTAL_FIDC_PROVIDER)")
  })

  it('nao inventa adapter Vortx ou Portal Custodia', () => {
    expect(migration).not.toMatch(/https?:\/\/[^'\s]*(vortx|custodia)/i)
    expect(portalRuntime).not.toMatch(/adapter[_-]?key[^\n]*(vortx|custodia)/i)
  })
})
