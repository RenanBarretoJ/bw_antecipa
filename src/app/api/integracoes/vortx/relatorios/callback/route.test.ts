import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ repo: vi.fn(), receive: vi.fn(), capture: vi.fn(), after: vi.fn(), process: vi.fn(), inclusion: vi.fn() }))
vi.mock('@/lib/integracoes/vortx/inclusao-processamento.server', async original => ({
  ...await original<object>(), processarProximaInclusaoVortx: mocks.inclusion,
}))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/integracoes/vortx/estoque-processamento.server', async original => ({
  ...await original<object>(), processarProximoEstoqueVortx: mocks.process,
}))
vi.mock('@/lib/integracoes/vortx/relatorios-callback-capture.server', () => ({ iniciarCapturaCallback: mocks.capture }))
vi.mock('@/lib/integracoes/vortx/relatorios-callback-repository.server', () => ({ criarRepositorioCallbackRelatorio: mocks.repo }))
vi.mock('@/lib/integracoes/vortx/relatorios-callback-handler.server', () => ({ receberCallbackRelatorio: mocks.receive }))
import { POST } from './route'
const fund = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/vortx-real-data-preview', NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co',
  VORTX_REPORTS_PREVIEW_ENABLED: 'true', VORTX_REPORTS_PREVIEW_FUNDO_ID: fund, VORTX_REPORT_CALLBACK_PREVIEW_ENABLED: 'true', VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED: 'true' }
const request = () => new Request('https://example.invalid/callback?token=synthetic-secret', { method: 'POST', body: '{}' })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); mocks.repo.mockReset(); mocks.receive.mockReset(); mocks.capture.mockReset(); mocks.after.mockReset(); mocks.process.mockReset(); mocks.inclusion.mockReset() })
describe('callback Preview boundary and sanitized logging', () => {
  it('receives production callbacks only with independent readiness and the production Fund', async () => {
    for (const [key,value] of Object.entries({VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',
      NEXT_PUBLIC_SUPABASE_URL:'https://wwsndnuvnjuabpbjwlck.supabase.co',INTEGRATION_RUNTIME_ENV:'producao',
      VORTX_REPORTS_PRODUCTION_ENABLED:'true',VORTX_REPORTS_PRODUCTION_FUNDO_ID:fund,
      VORTX_REPORTS_PREVIEW_FUNDO_ID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      VORTX_REPORT_CALLBACK_PRODUCTION_ENABLED:'true',VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED:'true'})) vi.stubEnv(key,value)
    const req=request()
    vi.spyOn(console,'info').mockImplementation(()=>{})
    mocks.repo.mockReturnValue({});mocks.receive.mockResolvedValue(new Response(null,{status:200}))
    expect((await POST(req)).status).toBe(200)
    expect(mocks.receive).toHaveBeenCalledWith(req,{},fund,expect.any(Function))
    expect(mocks.capture).not.toHaveBeenCalled()
  })
  it.each([200, 400, 401, 503])('Inclusion wakes only after committed callback %i and its own flag', async status => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    vi.stubEnv('VORTX_REPORT_INCLUSION_PROCESSING_ENABLED', 'true')
    vi.stubEnv('VORTX_REPORT_STOCK_PROCESSING_ENABLED', 'false')
    vi.stubEnv('VORTX_REPORT_DOWNLOAD_HOSTS', 'reports.example.invalid')
    mocks.repo.mockReturnValue({}); mocks.receive.mockResolvedValue(new Response(null, { status }))
    mocks.inclusion.mockResolvedValue({ estado: 'PERSISTIDO', inclusoes: 1, publicado: false })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    expect((await POST(request())).status).toBe(status)
    expect(mocks.after).toHaveBeenCalledTimes(status === 200 ? 1 : 0)
    if (status === 200) { await mocks.after.mock.calls[0][0](); expect(mocks.inclusion).toHaveBeenCalledOnce() }
    else expect(mocks.inclusion).not.toHaveBeenCalled()
    expect(mocks.process).not.toHaveBeenCalled()
  })
  it.each([200,400,401,503])('never clones or captures the request after retirement, including HTTP %i', async status => {
    for (const [key,value] of Object.entries(env)) vi.stubEnv(key,value)
    vi.stubEnv('VORTX_REPORT_CALLBACK_RAW_CAPTURE_ID',fund)
    vi.stubEnv('VORTX_REPORT_CALLBACK_RAW_ENDPOINT_ID',fund)
    vi.stubEnv('VORTX_REPORT_CALLBACK_RAW_CAPTURE_UNTIL',new Date(Date.now()+3600000).toISOString())
    vi.stubEnv('VORTX_REPORT_CALLBACK_PROTOCOL_CAPTURE_UNTIL',new Date(Date.now()+3600000).toISOString())
    const req=request(), clone=vi.spyOn(req,'clone'), log=vi.spyOn(console,'info').mockImplementation(()=>{})
    mocks.repo.mockReturnValue({});mocks.receive.mockResolvedValue(new Response(null,{status}))
    expect((await POST(req)).status).toBe(status)
    expect(clone).not.toHaveBeenCalled();expect(mocks.capture).not.toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/synthetic-secret|private_capture|corpo|headers|https:/)
  })
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
  it.each([200, 400, 401, 503])('wakes the durable processor only after committed HTTP 200, not %i', async status => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    vi.stubEnv('VORTX_REPORT_STOCK_PROCESSING_ENABLED', 'true')
    vi.stubEnv('VORTX_REPORT_DOWNLOAD_HOSTS', 'reports.example.invalid')
    mocks.repo.mockReturnValue({}); mocks.receive.mockResolvedValue(new Response(null, { status }))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    expect((await POST(request())).status).toBe(status)
    expect(mocks.after).toHaveBeenCalledTimes(status === 200 ? 1 : 0)
    expect(mocks.process).not.toHaveBeenCalled() // Scheduling does not block the acknowledgement.
  })
  it('preserves the committed receipt when scheduling fails', async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    vi.stubEnv('VORTX_REPORT_STOCK_PROCESSING_ENABLED', 'true'); vi.stubEnv('VORTX_REPORT_DOWNLOAD_HOSTS', 'reports.example.invalid')
    mocks.repo.mockReturnValue({}); mocks.receive.mockResolvedValue(new Response(null, { status: 200 }))
    mocks.after.mockImplementation(() => { throw new Error('private-scheduler-error') })
    vi.spyOn(console, 'info').mockImplementation(() => {}); const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await POST(request())).status).toBe(200)
    expect(log).toHaveBeenCalledWith('vortx_stock_processing', { estado: 'AGENDAMENTO_INDISPONIVEL' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-scheduler-error')
  })
})
