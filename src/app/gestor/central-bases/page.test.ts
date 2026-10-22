import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
const m=vi.hoisted(()=>({auth:vi.fn(),fund:vi.fn(),history:vi.fn(),position:vi.fn(),walletHistory:vi.fn()}))
vi.mock('@/lib/auth/authorization',()=>({requireGestor:m.auth}))
vi.mock('@/lib/gestor/contexto-fundo.server',()=>({resolverContextoFundoGestor:m.fund}))
vi.mock('@/lib/integracoes/vortx/relatorios-contexto.server',()=>({carregarHistoricoRelatorios:m.history}))
vi.mock('@/app/admin/fundos/relatorios-vortx-actions',()=>({solicitarRelatorioVortx:vi.fn()}))
vi.mock('@/app/gestor/dados-financeiros/carteira-actions',()=>({processarCarteiraVortxAction:vi.fn()}))
vi.mock('@/lib/integracoes/vortx/carteira-posicao.server',()=>({carregarPosicaoCarteiraVortx:m.position,carregarHistoricoCarteiraVortx:m.walletHistory}))
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}))
import Page from './page'
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
beforeEach(()=>{
  vi.resetAllMocks()
  const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/vortx-real-data-preview',NEXT_PUBLIC_SUPABASE_URL:'https://phdckowbexkkvuwnzeaf.supabase.co',VORTX_REPORTS_PREVIEW_ENABLED:'true',VORTX_REPORTS_PREVIEW_FUNDO_ID:id}
  for(const [key,value] of Object.entries(env))vi.stubEnv(key,value)
  m.auth.mockResolvedValue({user:{id:'synthetic'}})
  m.position.mockResolvedValue(null)
  m.walletHistory.mockResolvedValue({ registros: [], total: 0, pagina: 1, filtros: {} })
  m.fund.mockResolvedValue({fundoId:id,fundoNome:'Fundo ativo QA'})
  m.history.mockResolvedValue({contexto:{fundo:{id,nome:'Fundo ativo QA',cnpj:'00000000000000'},podeSolicitar:true,versoes:[]},historico:{total:0,solicitacoes:[]}})
})
afterEach(()=>vi.unstubAllEnvs())
describe('Central de Bases do Gestor',()=>{
  it('deriva Fundo do contexto autenticado e limita paginação',async()=>{
    const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({pagina:'20000'})}))
    expect(m.history).toHaveBeenCalledExactlyOnceWith(id,10000,{})
    expect(m.fund).toHaveBeenCalledWith({user:{id:'synthetic'}})
    expect(html).toContain('Central de Bases');expect(html).toContain('Fundo ativo QA')
    expect(html).not.toContain('Configurar integração')
  })
  it('preserva a rota e encaminha filtros normalizados sem aceitar Fundo da URL', async () => {
    await Page({ searchParams: Promise.resolve({ tipo: 'Inclusao', origem: 'CRON', estado: 'aceita', referencia: '2026-10-19' }) })
    expect(m.history).toHaveBeenCalledExactlyOnceWith(id, 1, { tipo: 'Inclusao', origem: 'CRON', estado: 'aceita', referencia: '2026-10-19' })
  })
  it('não carrega relatórios fora da Preview habilitada',async()=>{
    vi.stubEnv('VERCEL_ENV','production')
    const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}))
    expect(m.history).not.toHaveBeenCalled();expect(html).toContain('ainda não está habilitada')
  })
  it('outro Fundo ativo não usa silenciosamente a integração da Preview',async()=>{
    m.fund.mockResolvedValue({fundoId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',fundoNome:'Outro Fundo'})
    await Page({searchParams:Promise.resolve({})});expect(m.history).not.toHaveBeenCalled()
  })
  it('mostra última posição e histórico mesmo com novos processamentos desabilitados', async () => {
    vi.stubEnv('VORTX_CARTEIRA_PROCESSING_ENABLED', 'false')
    m.auth.mockResolvedValue({ user: { id: 'synthetic' }, supabase: 'authenticated-client' })
    m.position.mockResolvedValue({ dataReferencia: '2026-10-21', patrimonioLiquidoTotal: '60.0000', cotas: [{ codigoCarteira: 'QA', rotulo: 'QA', patrimonioLiquido: '60.0000' }] })
    const query = { carteiraEstado: 'RETIFICADA', carteiraPagina: '2' }
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }))
    expect(m.walletHistory).toHaveBeenCalledWith('authenticated-client', id, query)
    expect(html).toContain('Histórico da carteira'); expect(html).toContain('21/10/2026')
    expect(html).not.toContain('Persistência ainda não habilitada')
    expect(html).toContain('O processamento operacional ainda não foi habilitado')
  })
  it('falha de autenticação ou vínculo não é apresentada como histórico vazio',async()=>{
    m.fund.mockRejectedValue(new Error('sem vínculo'))
    await expect(Page({searchParams:Promise.resolve({})})).rejects.toThrow('sem vínculo');expect(m.history).not.toHaveBeenCalled()
  })
})
