import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ rpc }) }))
import { notificarGestoresCadastro } from './cadastro.server'

const input = {
  cedenteId: '23000000-0000-4000-8000-000000000001',
  titulo: 'Documento enviado', mensagem: 'Documento cadastral atualizado.',
  tipo: 'documento_enviado' as const, eventoKey: 'documento:qa:versao:2',
}

describe('shared registration notifications', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('delegates fund and recipient resolution to the restricted RPC', async () => {
    rpc.mockResolvedValue({ data: 3, error: null })
    expect(await notificarGestoresCadastro(input)).toEqual({ success: true, criadas: 3 })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('notificar_gestores_cadastro_cedente', {
      p_cedente_id: input.cedenteId, p_titulo: input.titulo, p_mensagem: input.mensagem,
      p_tipo: input.tipo, p_evento_key: input.eventoKey,
    })
  })

  it('does not fall back to a global broadcast when there are no active links', async () => {
    rpc.mockResolvedValue({ data: 0, error: null })
    expect(await notificarGestoresCadastro(input)).toEqual({ success: true, criadas: 0 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('logs only the code/type, without SQL or document contents', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'SQL sensitive content' } })
    expect(await notificarGestoresCadastro(input)).toEqual({ success: false })
    expect(log).toHaveBeenCalledWith(expect.any(String), { code: '22023', tipo: input.tipo })
    expect(JSON.stringify(log.mock.calls)).not.toContain('SQL sensitive content')
    log.mockRestore()
  })

  it('reports transport failure without misreporting a committed domain action', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockRejectedValue(new Error('secret connection string'))
    expect(await notificarGestoresCadastro(input)).toEqual({ success: false })
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret connection string')
    log.mockRestore()
  })
})
