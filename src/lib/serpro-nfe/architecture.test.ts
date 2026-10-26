import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261026163837_s1_serpro_nfe_gestor.sql', 'utf8')
const gestorPage = readFileSync('src/app/gestor/notas-fiscais/[id]/page.tsx', 'utf8')
const adminPage = readFileSync('src/app/admin/notas-fiscais/[id]/page.tsx', 'utf8')
const cedentePage = readFileSync('src/app/cedente/notas-fiscais/[id]/page.tsx', 'utf8')
const consultorPage = readFileSync('src/app/consultor/operacoes/[id]/page.tsx', 'utf8')
const action = readFileSync('src/lib/actions/situacao-fiscal-nfe.ts', 'utf8')
const provider = readFileSync('src/lib/serpro-nfe/provider.server.ts', 'utf8')
const officialContract = JSON.parse(readFileSync(
  'src/lib/serpro-nfe/__fixtures__/consulta-nfe-df.openapi.contract.json',
  'utf8',
)) as { queryBaseUrl: string; trialQueryBaseUrl: string; sourceSha256: string }

describe('arquitetura S1 privativa e desabilitada por padrão', () => {
  it('não renderiza o card em Cedente ou Consultor e exige papel servidor', () => {
    expect(gestorPage).toContain('<SituacaoFiscalNfeCard')
    expect(cedentePage).not.toContain('SituacaoFiscalNfeCard')
    expect(consultorPage).not.toContain('SituacaoFiscalNfeCard')
    expect(action).toContain("requireRole(['gestor', 'super_admin'])")
    expect(adminPage).toContain("requireRole('super_admin')")
    expect(adminPage).toContain("rpc('obter_nfe_identidade_fiscal_admin'")
    expect(adminPage).not.toContain("from('notas_fiscais')")
    expect(migration).toContain('IF NOT (SELECT private.usuario_e_super_admin()) THEN')
  })

  it('RLS restringe leitura por Fundo e escrita ao service_role', () => {
    const rlsPolicies = migration.slice(
      migration.indexOf('CREATE POLICY nfe_fiscal_snapshots_gestor_admin_select'),
      migration.indexOf('REVOKE ALL ON TABLE public.nfe_fiscal_snapshots'),
    )
    expect(migration).toContain('private.financeiro_gestor_tem_acesso_fundo(fundo_id)')
    expect(migration).toContain('private.c1_1_usuario_e_super_admin_rls()')
    expect(rlsPolicies).not.toContain('private.usuario_e_super_admin()')
    expect(migration).toContain('REVOKE ALL ON TABLE public.nfe_fiscal_consultas FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT SELECT ON TABLE public.nfe_fiscal_consultas TO authenticated')
    expect(migration).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL) ON TABLE public\.nfe_fiscal_consultas TO authenticated/)
    expect(migration).toContain("COALESCE(auth.role(), '') <> 'service_role'")
  })

  it('não faz backfill, não adiciona realtime/cron e só enfileira NFE submetida', () => {
    expect(migration).toContain("COALESCE(NEW.tipo_documento_fiscal, '') <> 'NFE'")
    expect(migration).toContain("NEW.status::text <> 'submetida'")
    expect(migration).not.toMatch(/INSERT INTO public\.nfe_fiscal_snapshots\s*\([^;]+?\)\s*SELECT\b/i)
    expect(migration).not.toContain('supabase_realtime')
    expect(migration).not.toContain('cron.schedule')
  })

  it('possui idempotência, fencing, orçamento e lock de concorrência', () => {
    expect(migration).toContain('nfe_fiscal_snapshots_idempotency_unique')
    expect(migration).toContain('FOR UPDATE SKIP LOCKED')
    expect(migration).toContain('lease_token = p_lease_token')
    expect(migration).toContain('daily_budget <= v_state.calls_today')
    expect(migration).toContain("circuit_state = 'OPEN'")
  })

  it('exige gates explícitos e endpoint oficial exato no adapter', () => {
    for (const gate of ['SERPRO_NFE_WORKER_ENABLED', 'SERPRO_NFE_CONTRACT_VERIFIED', 'SERPRO_NFE_QUERY_ENABLED']) {
      expect(provider).toContain(gate)
    }
    expect(provider).toContain("from './official-contract'")
    expect(provider).not.toContain('https://gateway.apiserpro.serpro.gov.br/nfe/1/')
    expect(officialContract.queryBaseUrl).toBe('https://gateway.apiserpro.serpro.gov.br/consulta-nfe-df/api/v1/nfe/')
    expect(officialContract.trialQueryBaseUrl).not.toBe(officialContract.queryBaseUrl)
    expect(officialContract.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(provider).toContain("throw new SerproNfeError('CAPABILITY_UNVERIFIED')")
  })
})
