import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ enabled: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/integracoes/vortx/carteira-rotina.server', () => ({ rotinaCarteiraPermitida: m.enabled, executarRotinaCarteiraVortx: m.run }))
import { GET } from './route'
const url = 'https://example.invalid/api/cron/vortx-carteira', headers = { authorization: 'Bearer synthetic-secret' }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('CRON_SECRET', 'synthetic-secret'); m.enabled.mockReturnValue(true); m.run.mockResolvedValue({ estado: 'AGUARDANDO_COTAS' }) })
afterEach(() => vi.unstubAllEnvs())
describe('cron exclusivo de carteira', () => {
  it('fora do escopo nao executa', async () => {
    m.enabled.mockReturnValue(false); expect((await GET(new Request(url, { headers }))).status).toBe(404); expect(m.run).not.toHaveBeenCalled()
  })
  it.each([undefined, 'Bearer wrong', 'synthetic-secret', 'bearer synthetic-secret'])('nega autorizacao invalida %s', async auth => {
    expect((await GET(new Request(url, { headers: auth ? { authorization: auth } : {} }))).status).toBe(401); expect(m.run).not.toHaveBeenCalled()
  })
  it('nao aceita Fundo/data por query', async () => {
    expect((await GET(new Request(url + '?referencia=2026-10-20', { headers }))).status).toBe(400); expect(m.run).not.toHaveBeenCalled()
  })
  it('faz uma unica execucao autorizada sem cache', async () => {
    const response = await GET(new Request(url, { headers }))
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(m.run).toHaveBeenCalledOnce()
  })
  it('falha nao expoe detalhes nem provoca repeticao', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try { m.run.mockRejectedValue(new Error('secret')); const response = await GET(new Request(url, { headers })); expect(response.status).toBe(503); expect(await response.text()).toBe(''); expect(m.run).toHaveBeenCalledOnce() }
    finally { warn.mockRestore() }
  })
})
