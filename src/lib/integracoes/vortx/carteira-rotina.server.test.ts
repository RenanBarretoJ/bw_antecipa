import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ processar: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./carteira-persistencia.server', () => ({ consultarEPersistirCarteiraVortx: m.processar }))
import { executarRotinaCarteiraVortx } from './carteira-rotina.server'
const fund = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const env = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', NEXT_PUBLIC_SUPABASE_URL: 'https://wwsndnuvnjuabpbjwlck.supabase.co', INTEGRATION_RUNTIME_ENV: 'producao', VORTX_REPORTS_PRODUCTION_ENABLED: 'true', VORTX_REPORTS_PRODUCTION_FUNDO_ID: fund, VORTX_CARTEIRA_PROCESSING_ENABLED: 'true', VORTX_CARTEIRA_DAILY_ENABLED: 'true' }
beforeEach(() => { vi.resetAllMocks(); m.processar.mockResolvedValue({ estado: 'PERSISTIDA', id: 'internal-private-id' }) })
describe('rotina independente da carteira Vortx', () => {
  it('executa uma vez D-1 util depois das 17h, nao retorna IDs internos', async () => {
    expect(await executarRotinaCarteiraVortx(env, new Date('2026-10-22T20:00:00Z'))).toEqual({ estado: 'PERSISTIDA', dataOperacional: '2026-10-22', dataReferencia: '2026-10-21' })
    expect(m.processar).toHaveBeenCalledExactlyOnceWith({ fundoId: fund, dataReferencia: '2026-10-21' })
  })
  it.each(['2026-10-22T12:30:00Z', '2026-10-12T20:00:00Z'])('nao consulta fora da janela em %s', async instant => {
    expect(await executarRotinaCarteiraVortx(env, new Date(instant))).toMatchObject({ estado: 'IGNORADA' })
    expect(m.processar).not.toHaveBeenCalled()
  })
  it.each([{ VORTX_CARTEIRA_DAILY_ENABLED: 'false' }, { VORTX_CARTEIRA_PROCESSING_ENABLED: 'false' }, { VERCEL_ENV: 'preview' }])('permanece inerte sem autorizacao explicita %j', async change => {
    expect(await executarRotinaCarteiraVortx({ ...env, ...change })).toEqual({ estado: 'DESABILITADA' }); expect(m.processar).not.toHaveBeenCalled()
  })
  it('carteira incompleta aguarda, sem repetir automaticamente a API', async () => {
    m.processar.mockResolvedValue({ estado: 'AGUARDANDO_COTAS', cotasPendentes: [{ codigoCarteira: 'QA' }] })
    expect(await executarRotinaCarteiraVortx(env, new Date('2026-10-22T20:00:00Z'))).toMatchObject({ estado: 'AGUARDANDO_COTAS' })
    expect(m.processar).toHaveBeenCalledOnce()
  })
})
