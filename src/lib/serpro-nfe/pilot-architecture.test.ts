import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261028140420_s2_1a1_serpro_selective_pilot_claim.sql',
  'utf8',
)
const genericWorker = readFileSync('src/lib/serpro-nfe/worker.server.ts', 'utf8')
const pilotWorker = readFileSync('src/lib/serpro-nfe/pilot-worker.server.ts', 'utf8')

describe('arquitetura S2.1A.1 do claim seletivo', () => {
  it('mantem piloto seletivo e operacional sem fallback para fila historica', () => {
    // S2.2 deliberately retires generic pickup in the product worker. The
    // frozen pilot still requires its exact authorization; neither may scan S1.
    expect(genericWorker).toContain("db.rpc('nfe_fiscal_operational_claim', { p_limit: 1 })")
    expect(genericWorker).not.toContain("db.rpc('nfe_fiscal_claim'")
    expect(pilotWorker).toContain("db.rpc('nfe_fiscal_pilot_claim'")
    expect(pilotWorker).not.toContain("db.rpc('nfe_fiscal_claim'")
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.nfe_fiscal_claim(')
    expect(migration).not.toContain('FOR UPDATE SKIP LOCKED')
    expect(migration).not.toMatch(/ORDER BY[^;]+LIMIT 1/i)
  })

  it('vincula autorizacao, consulta, Fundo, NF, chave, nonce, operador e sessao MFA', () => {
    for (const required of [
      'p_authorization_id', 'p_consulta_id', 'p_fundo_id', 'p_nota_fiscal_id',
      'p_chave_acesso', 'p_nonce_hash', 'p_operador_id', 'operador_session_id',
      "s.aal = 'aal2'", "se.metodo = 'totp'", "mf.status = 'verified'",
    ]) expect(migration).toContain(required)
    expect(migration).toContain('nfe_fiscal_pilot_one_consumption_per_consulta_idx')
    expect(migration).toContain('v_snapshot.chave_acesso IS DISTINCT FROM p_chave_acesso')
  })

  it('reserva budget e consome autorizacao na mesma funcao do claim', () => {
    const claim = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.nfe_fiscal_pilot_claim'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.nfe_fiscal_pilot_complete'),
    )
    expect(claim).toContain("SET status = 'CONSUMIDA'")
    expect(claim).toContain("SET status = 'EM_CONSULTA'")
    expect(claim).toContain('SET calls_today = CASE')
    expect(claim).toContain('FOR UPDATE')
  })

  it('impede requeue e nao agenda retry no caminho piloto', () => {
    expect(migration).toContain('nfe_fiscal_pilot_prevent_requeue')
    expect(migration).toContain("SET status = 'INCONCLUSIVO'")
    expect(migration).toContain('proxima_tentativa_em = NULL')
    expect(pilotWorker).not.toContain('setTimeout')
    expect(pilotWorker).not.toContain('for (')
  })

  it('restringe tabela privada e RPCs a service_role', () => {
    expect(migration).toContain('ALTER TABLE private.nfe_fiscal_pilot_authorizations FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role')
    expect(migration.match(/FROM PUBLIC, anon, authenticated, service_role;/g)?.length).toBeGreaterThanOrEqual(5)
    expect(migration.match(/TO service_role;/g)?.length).toBe(4)
    expect(migration).toContain("COALESCE((SELECT auth.jwt())->>'role', '') <> 'service_role'")
    expect(migration).toContain("SET search_path = ''")
  })

  it('nao cria endpoint, cron, segredo ou ativacao', () => {
    expect(migration).not.toContain('cron.schedule')
    expect(migration).not.toContain('SERPRO_NFE_CONSUMER_KEY')
    expect(migration).not.toMatch(/SET\s+capability_state\s*=\s*'ENABLED'/i)
    expect(pilotWorker).not.toContain('NEXT_PUBLIC')
    expect(pilotWorker).not.toContain('console.')
  })
})
