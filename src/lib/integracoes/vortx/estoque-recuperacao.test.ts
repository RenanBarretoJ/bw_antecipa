import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), process: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('./estoque-processamento.server', () => ({ processamentoEstoquePreviewPermitido: (env: Record<string, string>) => env.VERCEL_ENV === 'preview',
  processarProximoEstoqueVortx: mocks.process }))
import { retomarDownloadEstoqueVortx } from './estoque-recuperacao.server'
const env = { VERCEL_ENV: 'preview', VORTX_REPORTS_PREVIEW_FUNDO_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  VERCEL_GIT_COMMIT_REF: 'integration/vortx-main-20261021',
  NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co', VORTX_REPORTS_PREVIEW_ENABLED: 'true' }
beforeEach(() => vi.resetAllMocks())
describe('explicit technical stock download recovery', () => {
  it('does not touch anything outside approved Preview', async () => {
    expect(await retomarDownloadEstoqueVortx({ VERCEL_ENV: 'production' })).toEqual({ estado: 'DESABILITADO' })
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled()
  })
  it('does not process when SQL denied recovery', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    expect(await retomarDownloadEstoqueVortx(env)).toEqual({ estado: 'AGUARDANDO_PAR' }); expect(mocks.process).not.toHaveBeenCalled()
  })
  it('starts only after SQL authorized and audited the retry', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null }); mocks.process.mockResolvedValue({ estado: 'REVISAO', publicado: false })
    expect(await retomarDownloadEstoqueVortx(env)).toEqual({ estado: 'REVISAO', publicado: false })
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_fundo_id: env.VORTX_REPORTS_PREVIEW_FUNDO_ID })
    expect(mocks.process).toHaveBeenCalledWith(env)
  })
  it('fails closed on an indeterminate recovery result', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'synthetic' } })
    await expect(retomarDownloadEstoqueVortx(env)).rejects.toThrow('RECUPERACAO_INDISPONIVEL'); expect(mocks.process).not.toHaveBeenCalled()
  })
})
