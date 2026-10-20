import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ resolver: vi.fn(), history: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ rpc: mocks.history }) }))
vi.mock('@/lib/integracoes/resolver.server', () => ({
  integrationRuntimeEnvironment: () => 'homologacao', resolverIntegracaoPorCapability: mocks.resolver,
}))
import { filtroFonteFinanceira, resolverFonteFinanceira } from './fonte-financeira.server'
import { carregarPaginasFinanceiras } from './paginas-financeiras'

describe('fontes financeiras sem fallback cruzado', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.history.mockResolvedValue({ data: false, error: null }) })
  it('seleciona Vortx por provider, ambiente e carteira sem mudar runtime', async () => {
    mocks.resolver.mockResolvedValue({ status: 'CONFIGURADA', integrationVersion: {
      providerKey: 'VORTX', adapterKey: 'vortx_vrs', config: { codigo_carteira: 'C-01' },
    } })
    const source = await resolverFonteFinanceira('fundo-qa')
    expect(source).toEqual({ tipo: 'VORTX', ambiente: 'homologacao', codigoCarteira: 'C-01' })
    expect(filtroFonteFinanceira(source)).toBe('and(provedor.eq.VORTX,fonte_ambiente.eq.homologacao,fonte_carteira.eq.C-01)')
    expect(mocks.resolver).toHaveBeenCalledWith({ fundoId: 'fundo-qa', ambiente: 'homologacao', capability: 'ESTOQUE' })
  })
  it('mantem importacoes manuais legadas quando nao ha integracao', async () => {
    mocks.resolver.mockResolvedValue({ status: 'NAO_CONFIGURADA' })
    expect(filtroFonteFinanceira(await resolverFonteFinanceira('fundo-qa'))).toBe('provedor.neq.VORTX')
  })
  it('preserva Fromtis sem incluir linhas Vortx', async () => {
    mocks.resolver.mockResolvedValue({ status: 'CONFIGURADA', integrationVersion: { providerKey: 'SINQIA' } })
    expect(await resolverFonteFinanceira('fundo-qa')).toEqual({ tipo: 'LEGADO' })
  })
  it('nao faz fallback ao legado depois da revogacao/desativacao da Vortx', async () => {
    mocks.resolver.mockResolvedValue({ status: 'NAO_CONFIGURADA' })
    mocks.history.mockResolvedValue({ data: true, error: null })
    await expect(resolverFonteFinanceira('qa')).rejects.toThrow('legado nao sera usado')
    mocks.history.mockResolvedValue({ data: null, error: { message: 'indisponivel' } })
    await expect(resolverFonteFinanceira('qa')).rejects.toThrow('confirmar a fonte')
  })
  it('nao converte fonte indisponivel ou carteira ausente em legado', async () => {
    mocks.resolver.mockResolvedValue({ status: 'INDISPONIVEL' })
    await expect(resolverFonteFinanceira('qa')).rejects.toThrow('indisponivel')
    mocks.resolver.mockResolvedValue({ status: 'CONFIGURADA', integrationVersion: { providerKey: 'VORTX', adapterKey: 'vortx_vrs', config: {} } })
    await expect(resolverFonteFinanceira('qa')).rejects.toThrow('carteira valida')
    expect(() => filtroFonteFinanceira({ tipo: 'VORTX', ambiente: 'producao', codigoCarteira: 'x),provedor.eq.FROMTIS' })).toThrow('invalido')
  })
  it('pagina um snapshot maior que 1000 linhas sem perder parcelas', async () => {
    const rows = Array.from({ length: 1207 }, (_, id) => ({ id }))
    const query = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }))
    expect(await carregarPaginasFinanceiras(query)).toEqual(rows)
    expect(query).toHaveBeenCalledTimes(3)
  })
  it('propaga erro de pagina e nao declara uma lista parcial completa', async () => {
    await expect(carregarPaginasFinanceiras(async () => ({ data: null, error: { message: 'falha QA' } }))).rejects.toThrow('falha QA')
  })
})
