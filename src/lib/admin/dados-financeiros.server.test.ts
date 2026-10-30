import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAdmin, technical, from, importsQuery, linesQuery } = vi.hoisted(() => {
  const importsQuery = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() }
  const linesQuery = { select: vi.fn(), in: vi.fn(), order: vi.fn(), limit: vi.fn() }
  return { requireAdmin: vi.fn(), technical: vi.fn(), from: vi.fn(), importsQuery, linesQuery }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/admin-authorization', () => ({ requireSuperAdmin: requireAdmin }))
vi.mock('./configuracoes-tecnicas.server', () => ({ obterConfiguracoesTecnicasAdminFundo: technical }))
import { obterDadosFinanceirosAdminFundo } from './dados-financeiros.server'

const fund = '11111111-1111-4111-8111-111111111111'
const version = '22222222-2222-4222-8222-222222222222'
function imported(overrides: Record<string, unknown> = {}) {
  return { id: 'import-a', tipo_base: 'ESTOQUE', origem: 'API', status: 'PUBLICADA',
    integracao_fundo_versao_id: version, ...overrides }
}
function lineage(fundoId = fund) {
  return { fundo: { id: fundoId }, integracoes: [{ provider_key: 'VORTX', system_name: 'VRS 2.0',
    versoes: [{ id: version, configuracao_nao_sensivel: { unnecessary: 'never returned' } }] }],
  credenciais: [{ usuario_mascarado: 'must not reach page' }] }
}

describe('Central de Bases - linhagem por contrato Super Admin existente', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    for (const query of [importsQuery, linesQuery]) {
      query.select.mockReturnValue(query)
      query.order.mockReturnValue(query)
    }
    importsQuery.eq.mockReturnValue(importsQuery)
    linesQuery.in.mockReturnValue(linesQuery)
    importsQuery.limit.mockResolvedValue({ data: [imported()], error: null })
    linesQuery.limit.mockResolvedValue({ data: [], error: null })
    from.mockImplementation((table: string) => {
      if (table === 'importacoes_financeiras') return importsQuery
      if (table === 'importacao_linhas') return linesQuery
      throw new Error(`DIRECT_RESTRICTED_TABLE_READ:${table}`)
    })
    requireAdmin.mockResolvedValue({ supabase: { from } })
    technical.mockResolvedValue(lineage())
  })

  it('uses the authorized Fund RPC path instead of restricted table SELECT', async () => {
    const state = await obterDadosFinanceirosAdminFundo(fund)
    expect(requireAdmin).toHaveBeenCalledOnce()
    expect(technical).toHaveBeenCalledExactlyOnceWith(fund)
    expect(importsQuery.eq).toHaveBeenCalledWith('fundo_id', fund)
    expect(from.mock.calls.map(([table]) => table)).toEqual(['importacoes_financeiras', 'importacao_linhas'])
    expect(state.importacoes[0].fonte).toBe('VRS 2.0 / VORTX')
    expect(state.vigentes.ESTOQUE).toBe(state.importacoes[0])
    expect(JSON.stringify(state)).not.toMatch(/must not reach page|never returned|credenciais/)
  })
  it('does not fetch technical data for an empty history', async () => {
    importsQuery.limit.mockResolvedValue({ data: [], error: null })
    expect((await obterDadosFinanceirosAdminFundo(fund)).importacoes).toEqual([])
    expect(technical).not.toHaveBeenCalled()
    expect(from).toHaveBeenCalledExactlyOnceWith('importacoes_financeiras')
  })
  it('preserves manual and golden origins without a lineage query', async () => {
    importsQuery.limit.mockResolvedValue({ data: [imported({ origem: 'MANUAL', integracao_fundo_versao_id: null }),
      imported({ id: 'golden', origem: 'GOLDEN_DATASET', integracao_fundo_versao_id: null })], error: null })
    const state = await obterDadosFinanceirosAdminFundo(fund)
    expect(state.importacoes.map(item => item.fonte)).toEqual(['Importacao manual', 'RLX Golden QA'])
    expect(technical).not.toHaveBeenCalled()
  })
  it('preserves history and marks missing lineage unavailable', async () => {
    technical.mockResolvedValue({ fundo: { id: fund }, integracoes: [] })
    const state = await obterDadosFinanceirosAdminFundo(fund)
    expect(state.importacoes).toHaveLength(1)
    expect(state.importacoes[0].fonte).toBe('Fonte automatica indisponivel')
  })
  it('rejects metadata from another Fund', async () => {
    technical.mockResolvedValue(lineage('other-fund'))
    await expect(obterDadosFinanceirosAdminFundo(fund)).rejects.toThrow('confirmar a linhagem tecnica deste Fundo')
  })
  it('rejects malformed and ambiguous metadata', async () => {
    technical.mockResolvedValue({ fundo: { id: fund }, integracoes: null })
    await expect(obterDadosFinanceirosAdminFundo(fund)).rejects.toThrow('confirmar a linhagem tecnica')
    const data = lineage()
    data.integracoes.push(data.integracoes[0])
    technical.mockResolvedValue(data)
    await expect(obterDadosFinanceirosAdminFundo(fund)).rejects.toThrow('Linhagem tecnica ambigua')
  })
  it('does not hide authorization or MFA denial, nor switch to a privileged client', async () => {
    requireAdmin.mockRejectedValueOnce(new Error('MFA_REQUIRED'))
    await expect(obterDadosFinanceirosAdminFundo(fund)).rejects.toThrow('MFA_REQUIRED')
    expect(from).not.toHaveBeenCalled()
    technical.mockRejectedValueOnce(new Error('RPC_DENIED'))
    await expect(obterDadosFinanceirosAdminFundo(fund)).rejects.toThrow('RPC_DENIED')
  })
  it('keeps invalid-line samples, ordering and bounded reads', async () => {
    linesQuery.limit.mockResolvedValue({ data: [{ importacao_id: 'import-a', numero_linha: 3,
      status: 'WARNING', erros: [], avisos: ['QA warning'] }], error: null })
    const state = await obterDadosFinanceirosAdminFundo(fund)
    expect(state.importacoes[0].amostras_linhas).toEqual([{ numero_linha: 3, status: 'WARNING', erros: [], avisos: ['QA warning'] }])
    expect(importsQuery.limit).toHaveBeenCalledWith(100)
    expect(linesQuery.limit).toHaveBeenCalledWith(300)
    expect(linesQuery.in).toHaveBeenCalledWith('status', ['INVALIDA', 'WARNING'])
  })
})
