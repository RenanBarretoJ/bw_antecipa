import { afterEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ role: vi.fn(), config: vi.fn(), pickup: vi.fn() }))
vi.mock('@/lib/auth/authorization', () => ({ requireRole: m.role }))
vi.mock('@/lib/serpro-nfe/provider.server', () => ({ readSerproNfeRuntimeConfig: m.config }))
vi.mock('@/lib/serpro-nfe/dispatch.server', () => ({ scheduleSerproNfePickup: m.pickup }))
import { obterSituacaoFiscalNfe, solicitarAtualizacaoSituacaoFiscalNfe } from './situacao-fiscal-nfe'
const id = 'c1000000-0000-4000-8000-000000000001'
afterEach(() => vi.resetAllMocks())
describe('fiscal session action boundary', () => {
  it('expired login is rejected before RPC or pickup', async () => {
    m.role.mockRejectedValue(Error('UNAUTHENTICATED'))
    await expect(solicitarAtualizacaoSituacaoFiscalNfe(id, 'synthetic-reference-001')).rejects.toThrow('UNAUTHENTICATED')
    expect(m.pickup).not.toHaveBeenCalled()
  })
  it('runtime OFF never queues even if SQL was enabled in a prior runtime', async () => {
    const rpc = vi.fn()
    m.role.mockResolvedValue({ supabase: { rpc } })
    m.config.mockReturnValue({ ready: false })
    expect(await solicitarAtualizacaoSituacaoFiscalNfe(id, 'synthetic-reference-001')).toMatchObject({ success: false, code: 'PROVIDER_OFF' })
    expect(rpc).not.toHaveBeenCalled()
    expect(m.pickup).not.toHaveBeenCalled()
  })
  it('SQL derives the actor and a successful enqueue schedules only a hint', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { accepted: true, requestId: id }, error: null })
    m.role.mockResolvedValue({ supabase: { rpc } })
    m.config.mockReturnValue({ ready: true })
    expect(await solicitarAtualizacaoSituacaoFiscalNfe(id, 'synthetic-reference-001')).toMatchObject({ success: true })
    expect(m.role).toHaveBeenCalledWith(['gestor', 'super_admin'])
    expect(rpc).toHaveBeenCalledWith('solicitar_reconsulta_nfe_fiscal_operacional', {
      p_nota_fiscal_id: id, p_request_reference: 'synthetic-reference-001',
    })
    expect(m.pickup).toHaveBeenCalledOnce()
  })
  it('hides the action while preserving a red result when runtime OFF', async () => {
    const history = [{ status: 'CONCLUIDA' }]
    m.role.mockResolvedValue({ supabase: { rpc: vi.fn().mockResolvedValue({ data: {
      status: 'DIVERGENTE', provider: 'SERPRO', severity: 'VERMELHO', summary: 'synthetic critical result',
      consumptionMode: 'UNLIMITED_WITH_METERING', differences: [], events: [], history, consumption: {},
    }, error: null }) } })
    m.config.mockReturnValue({ ready: false })
    expect(await obterSituacaoFiscalNfe(id)).toMatchObject({ success: true, situation: {
      consumptionMode: 'OFF_ZERO_BUDGET', severity: 'VERMELHO', history,
    } })
  })
})
