import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactNode } from 'react'
const m = vi.hoisted(() => ({ fund: vi.fn(), history: vi.fn(), auth: vi.fn(), enabled: vi.fn(), allowed: vi.fn(), position: vi.fn(), walletHistory: vi.fn(), requests: vi.fn(), wallet: vi.fn(), process: vi.fn(), redirect: vi.fn((url: string): never => { throw new Error(`REDIRECT:${url}`) }) }))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect: m.redirect, notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('@/lib/admin/fundos.server', () => ({ obterAdminFundo: m.fund, listarAuditoriaAdminFundo: vi.fn() }))
vi.mock('@/lib/admin/usuarios.server', () => ({ listarGestoresAdminFundo: vi.fn() }))
vi.mock('@/lib/admin/configuracoes-tecnicas.server', () => ({ obterConfiguracoesTecnicasAdminFundo: vi.fn() }))
vi.mock('@/lib/admin/dados-financeiros.server', () => ({ obterDadosFinanceirosAdminFundo: vi.fn() }))
vi.mock('@/app/admin/fundos/vortx-vrs-actions', () => ({ obterConfiguracaoVortxVrsAdmin: vi.fn() }))
vi.mock('@/lib/auth/admin-authorization', () => ({ requireSuperAdmin: m.auth }))
vi.mock('@/lib/integracoes/vortx/relatorios-contexto.server', () => ({ carregarHistoricoRelatorios: m.history }))
vi.mock('@/lib/integracoes/vortx/relatorios-runtime', () => ({ relatoriosPermitidos: m.allowed }))
vi.mock('@/lib/integracoes/vortx/carteira-rotina', () => ({ carteiraProcessamentoPermitido: m.enabled }))
vi.mock('@/lib/integracoes/vortx/carteira-posicao.server', () => ({ carregarPosicaoCarteiraVortx: m.position, carregarHistoricoCarteiraVortx: m.walletHistory }))
vi.mock('@/lib/integracoes/vortx/carteira-diagnostic', () => ({ diagnosticoCarteiraPermitido: () => false }))
vi.mock('@/app/admin/fundos/carteira-processing-actions', () => ({ processarCarteiraVortxAdminAction: m.process }))
vi.mock('@/components/admin/vortx-carteira-operacional', () => ({ VortxCarteiraOperacional: m.wallet }))
vi.mock('@/components/admin/vortx-report-requests', () => ({ VortxReportRequests: (props: { carteiraOperacional: ReactNode; historicoHref: string }) => { m.requests(props); return createElement('section', { 'data-history': props.historicoHref }, props.carteiraOperacional) } }))
vi.mock('@/components/admin/fundo-lifecycle-action', () => ({ FundoLifecycleAction: () => null }))
vi.mock('@/components/admin/fundo-integracoes-tecnicas', () => ({ FundoIntegracoesTecnicas: () => null }))
vi.mock('@/components/admin/fundo-envios-operacionais', () => ({ FundoEnviosOperacionais: () => null }))
vi.mock('@/components/admin/fundo-dados-financeiros', () => ({ FundoDadosFinanceiros: () => null }))
vi.mock('@/components/admin/fundo-structural-form', () => ({ FundoStructuralForm: () => null }))
vi.mock('@/components/admin/admin-vinculo-search-dialog', () => ({ AdminVinculoSearchDialog: () => null }))
vi.mock('@/components/admin/gestor-fund-access-action', () => ({ GestorFundAccessAction: () => null }))
vi.mock('@/components/admin/vortx-carteira-diagnostic', () => ({ VortxCarteiraDiagnostic: () => null }))
import Page from './page'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
beforeEach(() => {
  vi.resetAllMocks()
  m.fund.mockResolvedValue({ id, nome: 'QA Fundo', cnpj: '98000000000196', ativo: true })
  m.auth.mockResolvedValue({ supabase: 'authenticated-client' }); m.allowed.mockReturnValue(true); m.enabled.mockReturnValue(true)
  m.history.mockResolvedValue({ contexto: { fundo: { id }, podeSolicitar: true, versoes: [{ ambiente: 'producao', capabilities: ['CARTEIRA'] }] }, historico: { total: 0, solicitacoes: [] } })
  m.wallet.mockReturnValue(createElement('div', null, 'Carteira operacional QA')); m.position.mockResolvedValue(null)
  m.walletHistory.mockResolvedValue({ registros: [], total: 0, pagina: 1, filtros: {} })
})
describe('Central de Bases do Super Admin', () => {
  it('redireciona o tab antigo preservando filtros antes de carregar dados', async () => {
    await expect(Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tab: 'dados-financeiros', pagina: '2', tipo: 'Inclusao' }) }))
      .rejects.toThrow(`REDIRECT:/admin/fundos/${id}?tab=central-bases&pagina=2&tipo=Inclusao`)
    expect(m.fund).not.toHaveBeenCalled(); expect(m.history).not.toHaveBeenCalled(); expect(m.process).not.toHaveBeenCalled()
  })
  it('monta o mesmo componente operacional com o Fundo da página e cliente autenticado', async () => {
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tab: 'central-bases', origem: 'CRON' }) }))
    expect(m.history).toHaveBeenCalledWith(id, 1, { origem: 'CRON' })
    expect(m.position).toHaveBeenCalledWith('authenticated-client', id)
    expect(html).toContain('Carteira operacional QA'); expect(html).toContain(`tab=central-bases`)
    const props = m.wallet.mock.calls[0][0]
    expect(props).toMatchObject({ habilitada: true, podeProcessar: true, capacidadePublicada: true })
    await props.processarAction({ dataReferencia: '2026-10-20' })
    expect(m.process).toHaveBeenCalledWith(id, { dataReferencia: '2026-10-20' })
  })
  it('separa ausência de capacidade de acesso operacional', async () => {
    m.history.mockResolvedValue({ contexto: { fundo: { id }, podeSolicitar: true, versoes: [{ ambiente: 'producao', capabilities: ['ESTOQUE'] }] }, historico: { total: 0, solicitacoes: [] } })
    renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tab: 'central-bases' }) }))
    expect(m.wallet.mock.calls[0][0]).toMatchObject({ capacidadePublicada: false, podeProcessar: true })
  })
  it('encaminha posição e histórico com cliente autenticado sem depender do flag de processamento', async () => {
    m.enabled.mockReturnValue(false)
    const posicao = { dataReferencia: '2026-10-21', patrimonioLiquidoTotal: '60.0000', cotas: [] }
    m.position.mockResolvedValue(posicao)
    const query = { tab: 'central-bases', carteiraEstado: 'RETIFICADA', carteiraPagina: '2' }
    renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) }))
    expect(m.walletHistory).toHaveBeenCalledWith('authenticated-client', id, query)
    expect(m.requests.mock.calls[0][0]).toMatchObject({ posicaoCarteira: posicao, historicoCarteira: { total: 0 }, historicoHref: `/admin/fundos/${id}?tab=central-bases&carteiraPagina=2&carteiraEstado=RETIFICADA` })
    expect(m.wallet.mock.calls[0][0]).toMatchObject({ posicaoInicial: posicao, habilitada: false })
  })
})
