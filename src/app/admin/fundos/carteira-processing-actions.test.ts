import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ admin: vi.fn(), contexto: vi.fn(), enabled: vi.fn(), worker: vi.fn(), posicao: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/admin-authorization', () => ({ requireSuperAdmin: m.admin }))
vi.mock('@/lib/integracoes/vortx/relatorios-contexto.server', () => ({ carregarContextoRelatorios: m.contexto }))
vi.mock('@/lib/integracoes/vortx/carteira-rotina', () => ({ carteiraProcessamentoPermitido: m.enabled }))
vi.mock('@/lib/integracoes/vortx/carteira-persistencia.server', () => ({ consultarEPersistirCarteiraVortx: m.worker }))
vi.mock('@/lib/integracoes/vortx/carteira-posicao.server', () => ({ carregarPosicaoCarteiraVortx: m.posicao }))
vi.mock('@/lib/operacoes/data-operacional.server', () => ({ obterDataCivilOperacional: () => '2026-10-22' }))
import { AuthorizationError } from '@/lib/auth/authorization'
import { processarCarteiraVortxAdminAction } from './carteira-processing-actions'
const fund = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
// The canonical platform role can authorize a Super Admin whose profile is also Gestor.
const auth = { user: { id: 'synthetic-admin' }, profile: { role: 'gestor' }, roles: ['gestor', 'super_admin'], supabase: {} }
const contexto = { fundo: { id: fund }, podeSolicitar: true, versoes: [{ id: version, ambiente: 'producao', capabilities: ['CARTEIRA'] }] }
const input = { dataReferencia: '2026-10-20' }
beforeEach(() => {
  vi.resetAllMocks(); m.admin.mockResolvedValue(auth); m.enabled.mockReturnValue(true); m.contexto.mockResolvedValue({ auth, contexto })
  m.worker.mockImplementation(async (_input, autorizar) => { await autorizar({ fundoId: fund, versaoId: version }); return { estado: 'PERSISTIDA', id: 'qa-import' } })
  m.posicao.mockResolvedValue({ dataReferencia: input.dataReferencia, patrimonioLiquidoTotal: '30.0000', cotas: [{ codigoCarteira: 'QA', rotulo: 'QA', patrimonioLiquido: '30.0000' }], vigente: true })
})
describe('processamento da carteira pelo Super Admin', () => {
  it('usa o Fundo da página e o mesmo worker/DTO, com autorização administrativa renovada', async () => {
    expect(await processarCarteiraVortxAdminAction(fund, input)).toMatchObject({ success: true, estado: 'PUBLICADA' })
    expect(m.worker).toHaveBeenCalledWith({ fundoId: fund, dataReferencia: input.dataReferencia }, expect.any(Function))
    expect(m.admin).toHaveBeenCalledTimes(3); expect(m.contexto).toHaveBeenCalledTimes(2)
    expect(m.posicao).toHaveBeenCalledWith(auth.supabase, fund, 'qa-import')
  })
  it.each(['fundoId', 'versaoId', 'resposta', 'patrimonioLiquidoTotal', 'mfaCode'])('rejeita campo arbitrário %s', async key => {
    expect(await processarCarteiraVortxAdminAction(fund, { ...input, [key]: 'tampered' })).toMatchObject({ success: false })
    expect(m.admin).not.toHaveBeenCalled(); expect(m.worker).not.toHaveBeenCalled()
  })
  it.each(['sem-id', ''])('não consulta com Fundo inválido %s', async id => {
    expect(await processarCarteiraVortxAdminAction(id, input)).toMatchObject({ success: false }); expect(m.worker).not.toHaveBeenCalled()
  })
  it('não executa sem habilitação ou com data futura', async () => {
    m.enabled.mockReturnValue(false)
    expect(await processarCarteiraVortxAdminAction(fund, input)).toMatchObject({ success: false })
    expect(await processarCarteiraVortxAdminAction(fund, { dataReferencia: '2026-10-23' })).toMatchObject({ success: false })
    expect(m.worker).not.toHaveBeenCalled()
  })
  it('preserva as recusas de role/MFA da autorização canônica', async () => {
    m.admin.mockRejectedValue(new AuthorizationError('Confirme o MFA desta sessão.', 'FORBIDDEN'))
    expect(await processarCarteiraVortxAdminAction(fund, input)).toEqual({ success: false, message: 'Confirme o MFA desta sessão.' })
    expect(m.worker).not.toHaveBeenCalled()
  })
  it.each([
    { ...contexto, podeSolicitar: false }, { ...contexto, fundo: { id: version } },
    { ...contexto, versoes: [] }, { ...contexto, versoes: [{ id: version, ambiente: 'producao', capabilities: ['ESTOQUE'] }] },
  ])('nega vínculo/capacidade ou Fundo indevido antes do provider (%#)', async invalid => {
    m.contexto.mockResolvedValue({ auth, contexto: invalid })
    expect(await processarCarteiraVortxAdminAction(fund, input)).toMatchObject({ success: false }); expect(m.worker).not.toHaveBeenCalled()
  })
  it('uma capacidade ausente orienta a configuração e não culpa o acesso do usuário', async () => {
    m.contexto.mockResolvedValue({ auth, contexto: { ...contexto, versoes: [] } })
    expect(await processarCarteiraVortxAdminAction(fund, input)).toMatchObject({ success: false, message: expect.stringContaining('Publique a capacidade Carteira') })
  })
  it('recusa troca de usuário e revogação posterior ao primeiro contexto', async () => {
    m.admin.mockResolvedValueOnce(auth).mockResolvedValueOnce(auth).mockRejectedValue(new AuthorizationError('Acesso administrativo revogado.', 'FORBIDDEN'))
    expect(await processarCarteiraVortxAdminAction(fund, input)).toMatchObject({ success: false }); expect(m.posicao).not.toHaveBeenCalled()
    m.admin.mockResolvedValue({ ...auth, user: { id: 'outro' } })
    m.contexto.mockResolvedValue({ auth, contexto })
    expect(await processarCarteiraVortxAdminAction(fund, input)).toMatchObject({ success: false })
  })
  it('nega mudança do Fundo/versão apresentada pelo worker antes da persistência', async () => {
    m.worker.mockImplementation(async (_input, autorizar) => autorizar({ fundoId: version, versaoId: version }))
    expect(await processarCarteiraVortxAdminAction(fund, input)).toMatchObject({ success: false }); expect(m.posicao).not.toHaveBeenCalled()
    m.worker.mockImplementation(async (_input, autorizar) => autorizar({ fundoId: fund, versaoId: fund }))
    expect(await processarCarteiraVortxAdminAction(fund, input)).toMatchObject({ success: false }); expect(m.posicao).not.toHaveBeenCalled()
  })
  it('preserva espera por cotas e duplicatas sem expor dados internos', async () => {
    m.worker.mockResolvedValue({ estado: 'AGUARDANDO_COTAS', dataReferencia: input.dataReferencia, cotasPendentes: [{ codigoCarteira: 'SUB', rotulo: 'Sub' }] })
    expect(await processarCarteiraVortxAdminAction(fund, input)).toMatchObject({ success: true, estado: 'AGUARDANDO_COTAS' }); expect(m.posicao).not.toHaveBeenCalled()
    m.worker.mockResolvedValue({ estado: 'DUPLICADA', id: 'qa-import' })
    expect(await processarCarteiraVortxAdminAction(fund, input)).toMatchObject({ success: true, estado: 'JA_REGISTRADA' })
  })
})
