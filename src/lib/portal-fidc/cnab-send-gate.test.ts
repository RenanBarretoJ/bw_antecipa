import { afterEach, describe, expect, it, vi } from 'vitest'

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from, rpc }) }))
vi.mock('@/lib/auth/mfa', () => ({ registrarEventoSeguranca: vi.fn() }))
import { enviarRemessaPortalFidc } from './integracao'

describe('gate antes de efeitos externos de envio', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks() })
  it.each([null, { codigo_originador: '001', tipo_recebivel: '01', status: 'rascunho' }])(
    'nao baixa arquivo, le segredo ou envia HTTP sem snapshot CNAB publicado: %j', async (configuracao) => {
      vi.stubEnv('INTEGRATION_RUNTIME_ENV', 'producao')
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() }
      for (const fn of [query.select, query.eq, query.order, query.limit]) fn.mockReturnValue(query)
      query.maybeSingle.mockResolvedValue({ data: { remessa: {
        id: 'r1', fundo_id: 'f1', status: 'gerada', configuracao,
      } }, error: null })
      from.mockReturnValue(query)
      rpc.mockResolvedValue({ data: {
        status: 'CONFIGURADA', integracao_fundo_id: 'i1', integracao_fundo_versao_id: 'v1',
        provider_key: 'SINQIA', system_name: 'Portal FIDC', adapter_key: 'sinqia_portal_fidc',
        endpoint_base: 'https://example.invalid', credential_ref: 'secret-ref', credencial_integracao_id: 'c1',
        identificador_cliente: 'QA', codigo_originador: null, versao: 1, configuracao_nao_sensivel: {},
      }, error: null })
      await expect(enviarRemessaPortalFidc('o1')).rejects.toThrow(/CNAB publicada/)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(from.mock.calls.map(([table]) => table)).toEqual(['remessas_cnab_operacoes'])
      expect(rpc.mock.calls.map(([name]) => name)).toEqual(['resolver_integracao_por_capability'])
    },
  )
})
