import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ repo: vi.fn(), receive: vi.fn() }))
vi.mock('@/lib/integracoes/vortx/relatorios-callback-repository.server', () => ({ criarRepositorioCallbackRelatorio: mocks.repo }))
vi.mock('@/lib/integracoes/vortx/relatorios-callback-handler.server', () => ({ receberCallbackRelatorio: mocks.receive }))
import { POST } from './route'
const fund = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/vortx-real-data-preview', NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co',
  VORTX_REPORTS_PREVIEW_ENABLED: 'true', VORTX_REPORTS_PREVIEW_FUNDO_ID: fund, VORTX_REPORT_CALLBACK_PREVIEW_ENABLED: 'true', VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED: 'true' }
const request = () => new Request('https://example.invalid/callback?token=synthetic-secret', { method: 'POST', body: '{}' })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); mocks.repo.mockReset(); mocks.receive.mockReset() })
describe('callback Preview boundary and sanitized logging', () => {
  it('returns 404 before creating admin client when disabled', async () => {
    vi.stubEnv('VORTX_REPORT_CALLBACK_PREVIEW_ENABLED', 'false')
    expect((await POST(request())).status).toBe(404)
    expect(mocks.repo).not.toHaveBeenCalled(); expect(mocks.receive).not.toHaveBeenCalled()
  })
  it('does not log URL/query/body when no handler diagnosis is returned', async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    mocks.repo.mockReturnValue({}); mocks.receive.mockResolvedValue(new Response(null, { status: 200 }))
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect((await POST(request())).status).toBe(200)
    expect(log).toHaveBeenCalledWith('vortx_callback_receipt', { status: 200, durationMs: expect.any(Number) })
    expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-secret')
  })
  it('logs the real handler diagnosis for an unauthenticated request, without body or query values', async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    const actual = await vi.importActual<typeof import('@/lib/integracoes/vortx/relatorios-callback-handler.server')>('@/lib/integracoes/vortx/relatorios-callback-handler.server')
    const repo = { autorizar: vi.fn(), persistir: vi.fn(), diagnosticarRejeicao: vi.fn() }
    mocks.repo.mockReturnValue(repo); mocks.receive.mockImplementation(actual.receberCallbackRelatorio)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const req = new Request(`https://example.invalid/callback?endpoint=${fund}`, { method: 'POST', body: 'synthetic-private-body',
      headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-private-header' } })
    expect((await POST(req)).status).toBe(401)
    expect(log).toHaveBeenCalledExactlyOnceWith('vortx_callback_receipt', {
      status: 401, durationMs: expect.any(Number), metodo: 'POST', tipoConteudo: 'JSON',
      endpointQuantidade: 1, tokenQuantidade: 0, endpointFormatoValido: true, tokenFormatoValido: false,
      autorizacao: 'NAO_EXECUTADA', etapa: 'PARAMETROS', motivo: 'TOKEN_AUSENTE',
    })
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/synthetic-private|https:|aaaaaaaa/)
    expect(repo.autorizar).not.toHaveBeenCalled(); expect(repo.persistir).not.toHaveBeenCalled()
    expect(repo.diagnosticarRejeicao).not.toHaveBeenCalled(); expect(req.bodyUsed).toBe(false)
  })
  it('handles missing backend configuration without echoing the error', async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    mocks.repo.mockImplementation(() => { throw new Error('synthetic-secret backend misconfigured') })
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const response = await POST(request())
    expect(response.status).toBe(503); expect(await response.text()).toBe('')
    expect(log).toHaveBeenCalledWith('vortx_callback_receipt', expect.objectContaining({ etapa: 'ROTA', motivo: 'FALHA_INESPERADA' }))
    expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-secret')
  })
})
