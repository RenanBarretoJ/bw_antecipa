import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ create: vi.fn(), notify: vi.fn(), audit: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: m.create }))
vi.mock('@/lib/notificacoes/cadastro.server', () => ({ notificarGestoresCadastro: m.notify }))
vi.mock('@/lib/actions/auditoria', () => ({ registrarLog: m.audit }))

function fixture() {
  const docs = [
    { id: 'doc-a', tipo: 'comprovante_endereco', analisado_em: '2026-06-01T12:00:00Z',
      cedente_id: 'cedente-a', atualizacao_solicitada_em: null, cedentes: { razao_social: 'QA A', user_id: 'qa-a' } },
    { id: 'doc-b', tipo: 'comprovante_endereco', analisado_em: '2026-08-01T12:00:00Z',
      cedente_id: 'cedente-b', atualizacao_solicitada_em: null, cedentes: { razao_social: 'QA B', user_id: 'qa-b' } },
  ]
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  const query = {
    select: vi.fn(), eq: vi.fn(),
    not: vi.fn().mockResolvedValue({ data: docs, error: null }), update,
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  const from = vi.fn().mockReturnValue(query)
  m.create.mockReturnValue({ from })
  m.notify.mockResolvedValue({ success: true, criadas: 2 })
  return { from, update }
}

describe('document expiry cron uses canonical shared-registration routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'))
    vi.stubEnv('CRON_SECRET', 'qa-test-only')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:59421')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'qa-test-only')
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('keeps each Cedente id and event type rather than selecting global profiles', async () => {
    const f = fixture()
    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/cron/documentos-vencidos', {
      headers: { authorization: 'Bearer qa-test-only' },
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ vencidos: 1, a_vencer_30: 1, cedentes_alertados: 1, erros: 0 })
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({
      cedenteId: 'cedente-a', tipo: 'documento_vencido', eventoKey: 'cron:documentos:2026-10-06',
    }))
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({
      cedenteId: 'cedente-b', tipo: 'documento_a_vencer', eventoKey: 'cron:documentos:2026-10-06',
    }))
    expect(f.from.mock.calls.every(([table]) => table === 'documentos')).toBe(true)
    expect(f.update).toHaveBeenCalledTimes(1)
    expect(m.audit).toHaveBeenCalledTimes(1)
  })

  it('rejects unauthenticated calls before resolving producers', async () => {
    fixture()
    const { GET } = await import('./route')
    expect((await GET(new Request('http://localhost/api/cron/documentos-vencidos'))).status).toBe(401)
    expect(m.create).not.toHaveBeenCalled()
    expect(m.notify).not.toHaveBeenCalled()
  })

  it('counts notification failures without claiming delivery or sending a fallback broadcast', async () => {
    fixture()
    m.notify.mockResolvedValue({ success: false })
    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/cron/documentos-vencidos', {
      headers: { authorization: 'Bearer qa-test-only' },
    }))
    expect(await response.json()).toMatchObject({ cedentes_alertados: 0, erros: 2 })
    expect(m.notify).toHaveBeenCalledTimes(2)
  })
})
