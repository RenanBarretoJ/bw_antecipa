import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ auth: vi.fn(), fundo: vi.fn(), contexto: vi.fn(), enabled: vi.fn(), processar: vi.fn(), posicao: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/authorization', async original => ({ ...await original<object>(), requireGestor: m.auth }))
vi.mock('@/lib/gestor/contexto-fundo.server', () => ({ resolverContextoFundoGestor: m.fundo }))
vi.mock('@/lib/integracoes/vortx/relatorios-contexto.server', () => ({ carregarContextoRelatorios: m.contexto }))
vi.mock('@/lib/integracoes/vortx/carteira-rotina', () => ({ carteiraProcessamentoPermitido: m.enabled }))
vi.mock('@/lib/integracoes/vortx/carteira-persistencia.server', () => ({ consultarEPersistirCarteiraVortx: m.processar }))
vi.mock('@/lib/integracoes/vortx/carteira-posicao.server', () => ({ carregarPosicaoCarteiraVortx: m.posicao }))
vi.mock('@/lib/operacoes/data-operacional.server', () => ({ obterDataCivilOperacional: () => '2026-10-22' }))
import { processarCarteiraVortxAction } from './carteira-actions'
const fund = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const auth = { user: { id: 'qa-actor' }, profile: { role: 'gestor' }, supabase: {} }
const context = { auth, contexto: { fundo: { id: fund }, podeSolicitar: true, versoes: [{ id: version, ambiente: 'producao', capabilities: ['CARTEIRA'] }] } }
const posicao = { dataReferencia: '2026-10-21', patrimonioLiquidoTotal: '30.0000', cotas: [{ codigoCarteira: 'QA', rotulo: 'Cota QA', patrimonioLiquido: '30.0000' }], vigente: true }
const input = { dataReferencia: '2026-10-21' }
beforeEach(() => {
  vi.resetAllMocks(); m.auth.mockResolvedValue(auth); m.fundo.mockResolvedValue({ fundoId: fund }); m.contexto.mockResolvedValue(context); m.enabled.mockReturnValue(true)
  m.processar.mockImplementation(async (_input, authorize) => { await authorize({ fundoId: fund, versaoId: version }); return { estado: 'PERSISTIDA', id: 'import-qa' } })
  m.posicao.mockResolvedValue(posicao)
})
describe('processamento da carteira pelo Gestor', () => {
  it('herda Fundo do servidor, exige sessao/contexto operacional sem TOTP adicional e devolve somente DTO', async () => {
    const result = await processarCarteiraVortxAction(input)
    expect(result).toMatchObject({ success: true, estado: 'PUBLICADA', posicao })
    expect(m.processar).toHaveBeenCalledWith({ fundoId: fund, dataReferencia: input.dataReferencia }, expect.any(Function))
    expect(m.contexto).toHaveBeenCalledTimes(2)
    expect(m.posicao).toHaveBeenCalledWith(auth.supabase, fund, 'import-qa')
    expect(JSON.stringify(result)).not.toMatch(/import-qa|lease|storage|token|mfaCode/)
  })
  it.each(['fundoId', 'versaoId', 'resposta', 'patrimonioLiquidoTotal', 'mfaCode'])('rejeita campo arbitrario %s antes de autenticar', async key => {
    expect(await processarCarteiraVortxAction({ ...input, [key]: 'tampered' })).toMatchObject({ success: false })
    expect(m.auth).not.toHaveBeenCalled(); expect(m.processar).not.toHaveBeenCalled()
  })
  it('rejeita data futura antes da consulta', async () => {
    expect(await processarCarteiraVortxAction({ dataReferencia: '2026-10-23' })).toMatchObject({ success: false }); expect(m.processar).not.toHaveBeenCalled()
  })
  it('nao usa worker sem habilitacao', async () => {
    m.enabled.mockReturnValue(false)
    expect(await processarCarteiraVortxAction(input)).toMatchObject({ success: false }); expect(m.processar).not.toHaveBeenCalled()
  })
  it.each([
    { ...context, contexto: { ...context.contexto, podeSolicitar: false } },
    { ...context, contexto: { ...context.contexto, fundo: { id: version } } },
    { ...context, contexto: { ...context.contexto, versoes: [] } },
    { ...context, auth: { ...auth, profile: { role: 'cedente' } } },
  ])('bloqueia contexto/role/capability invalido antes de executar (%#)', async invalid => {
    m.contexto.mockResolvedValue(invalid)
    expect(await processarCarteiraVortxAction(input)).toMatchObject({ success: false }); expect(m.processar).not.toHaveBeenCalled()
  })
  it('revogacao entre o contexto inicial e a leitura do worker e negada', async () => {
    m.contexto.mockResolvedValueOnce(context).mockResolvedValue({ ...context, contexto: { ...context.contexto, podeSolicitar: false } })
    expect(await processarCarteiraVortxAction(input)).toMatchObject({ success: false }); expect(m.posicao).not.toHaveBeenCalled()
  })
  it('aguarda cotas sem apresentar sucesso de publicacao nem valor parcial', async () => {
    m.processar.mockResolvedValue({ estado: 'AGUARDANDO_COTAS', dataReferencia: input.dataReferencia, cotasPendentes: [{ codigoCarteira: 'SUB', rotulo: 'Subordinada' }] })
    const result = await processarCarteiraVortxAction(input)
    expect(result).toMatchObject({ success: true, estado: 'AGUARDANDO_COTAS' }); expect(result).not.toHaveProperty('patrimonioLiquidoTotal'); expect(m.posicao).not.toHaveBeenCalled()
  })
  it('duplicata retificada nao e anunciada como vigente', async () => {
    m.processar.mockResolvedValue({ estado: 'DUPLICADA', id: 'import-qa' }); m.posicao.mockResolvedValue({ ...posicao, vigente: false })
    expect(await processarCarteiraVortxAction(input)).toMatchObject({ success: true, estado: 'CONTEUDO_HISTORICO' })
  })
  it('nao expoe erro de infraestrutura', async () => {
    m.processar.mockRejectedValue(new Error('postgres://secret'))
    expect(JSON.stringify(await processarCarteiraVortxAction(input))).not.toContain('postgres://secret')
  })
})
