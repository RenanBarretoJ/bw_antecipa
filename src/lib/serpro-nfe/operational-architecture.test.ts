import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261028195850_s2_2_serpro_operational_queue_history.sql',
  'utf8',
)
const worker = readFileSync('src/lib/serpro-nfe/worker.server.ts', 'utf8')
const provider = readFileSync('src/lib/serpro-nfe/provider.server.ts', 'utf8')
const action = readFileSync('src/lib/actions/situacao-fiscal-nfe.ts', 'utf8')
const card = readFileSync('src/components/notas-fiscais/SituacaoFiscalNfeCard.tsx', 'utf8')

describe('S2.2 operacional local e dormant', () => {
  it('separa OFF de ilimitado com medição e não instala execução remota', () => {
    expect(migration).toContain("DEFAULT 'OFF_ZERO_BUDGET'")
    expect(migration).toContain("consumption_mode <> 'UNLIMITED_WITH_METERING'")
    expect(provider).toContain("SERPRO_NFE_CONSUMPTION_MODE")
    expect(provider).toContain("consumptionMode === 'UNLIMITED_WITH_METERING'")
    expect(migration).not.toContain('cron.schedule')
    expect(migration).not.toContain('net.http')
  })

  it('enfileira no commit de importação e não depende da submissão tardia', () => {
    expect(migration).toContain('AFTER INSERT ON public.notas_fiscais')
    expect(migration).toContain("'AUTOMATICA_IMPORTACAO'")
    expect(migration).toContain("'AUTO_IMPORT_V1'")
    expect(migration).not.toContain("NEW.status::text <> 'submetida'")
    expect(migration).not.toMatch(/INSERT INTO public\.nfe_fiscal_snapshots\s*\([^;]+?\)\s*SELECT\b/i)
  })

  it('isola backlog pré-cutover da fila operacional', () => {
    expect(migration).toContain('eligible_post_cutover boolean NOT NULL DEFAULT false')
    expect(migration).toContain('e.eligible_post_cutover = true')
    expect(migration).toContain('e.requested_at >= v_state.cutover_at')
    expect(worker).toContain("nfe_fiscal_operational_claim")
    expect(worker).not.toContain("db.rpc('nfe_fiscal_claim'")
  })

  it('revalida sessão MFA de login sem challenge TOTP adicional', () => {
    expect(migration).toContain('FROM public.obter_sessao_mfa_atual() sessao')
    expect(migration).toContain("sessao.status = 'valid'")
    expect(action).toContain("requireRole(['gestor', 'super_admin'])")
    expect(action).not.toContain('challenge')
    expect(action).not.toContain('verifyTotp')
  })

  it('preserva idempotência, lease, 15 QPS, retries finitos e circuito', () => {
    expect(migration).toContain('nfe_fiscal_execucoes_idempotency_unique')
    expect(migration).toContain('nfe_fiscal_execucoes_one_active_idx')
    expect(migration).toContain('FOR UPDATE SKIP LOCKED')
    expect(migration).toContain('max_requests_per_second BETWEEN 1 AND 15')
    expect(migration).toContain('attempt_count BETWEEN 0 AND 3')
    expect(migration).toContain('lease_token = p_lease_token')
    expect(migration).toContain("p_http_status IN (401,403)")
  })

  it('mantém trilha append-only e isolamento por Fundo', () => {
    expect(migration).toContain('ALTER TABLE public.nfe_fiscal_execucoes FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE public.nfe_fiscal_execucao_eventos FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('private.financeiro_gestor_tem_acesso_fundo(fundo_id)')
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON public.nfe_fiscal_execucao_eventos')
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.solicitar_reconsulta_nfe_fiscal(uuid) FROM authenticated')
  })

  it('expõe somente o fluxo operacional e custo estimado no card interno', () => {
    expect(action).toContain("rpc('solicitar_reconsulta_nfe_fiscal_operacional'")
    expect(action).toContain('p_request_reference')
    expect(card).toContain('Reconsultar SERPRO')
    expect(card).toContain('Valores são estimativas, não fatura.')
    expect(card).toContain('Histórico de consultas')
  })
})
