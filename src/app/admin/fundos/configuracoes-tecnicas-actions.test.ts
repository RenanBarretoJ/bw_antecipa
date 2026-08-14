import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, from, requireSuperAdmin } = vi.hoisted(() => {
  const rpc = vi.fn()
  const from = vi.fn()
  return {
    rpc,
    from,
    requireSuperAdmin: vi.fn(async () => ({
      supabase: { rpc, from },
      profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })),
  }
})

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/admin-authorization', () => ({ requireSuperAdmin }))
vi.mock('@/lib/auth/sensitive-action', () => ({ autorizarEConsumirAcaoSensivel: vi.fn() }))
vi.mock('@/lib/admin/endpoint-seguro.server', () => ({ validarEndpointTecnicoSeguro: vi.fn() }))
vi.mock('@/lib/integracoes/registry.server', () => ({ integrationProviderRegistry: { get: vi.fn() } }))
vi.mock('@/lib/portal-fidc/credenciais', () => ({
  criptografarPortalFidcValor: vi.fn(),
  descriptografarPortalFidcValor: vi.fn(),
}))

import { salvarIntegracaoRascunhoAdmin } from './configuracoes-tecnicas-actions'

// UUID real aceito pelo PostgreSQL, mas sem nibble RFC de versao/variante.
const fundoId = 'e84fdd30-39ed-de86-292e-0d8d9d92d759'
const integrationId = '22222222-2222-4222-8222-222222222222'
const versionId = '33333333-3333-4333-8333-333333333333'

const base = {
  fundoId,
  integracaoFundoId: null,
  versaoId: null,
  providerKey: 'CUSTOM',
  systemName: 'PORTAL FIDC',
  adapterKey: null,
  capabilities: [],
  ambiente: 'homologacao',
  endpointBase: '',
  identificadorCliente: '',
  credencialIntegracaoId: null,
  configuracaoNaoSensivel: {},
  updatedAtEsperado: null,
}

describe('salvar rascunho de integracao tecnica', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({ data: { id: versionId, integracao_id: integrationId }, error: null })
    from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { cnpj: '68.522.785/0001-04' }, error: null }),
        }),
      }),
    })
  })

  it('usa CREATE com IDs nulos e permite draft incompleto', async () => {
    const result = await salvarIntegracaoRascunhoAdmin({
      ...base,
      endpointBase: 'https://teste.com.br',
      identificadorCliente: 'teste',
    })

    expect(result).toMatchObject({
      success: true,
      message: 'Rascunho criado com sucesso.',
      data: { id: versionId, integrationId },
    })
    expect(rpc).toHaveBeenCalledWith('admin_salvar_integracao_rascunho', expect.objectContaining({
      p_fundo_id: fundoId,
      p_integracao_fundo_id: null,
      p_versao_id: null,
      p_adapter_key: null,
      p_capabilities: [],
      p_endpoint_base: 'https://teste.com.br/',
      p_identificador_cliente: 'teste',
      p_credencial_integracao_id: null,
    }))
  })

  it('permite CREATE sem endpoint, adapter, credencial ou capability', async () => {
    const result = await salvarIntegracaoRascunhoAdmin({ ...base, systemName: 'TESTE QA' })

    expect(result).toMatchObject({ success: true, message: 'Rascunho criado com sucesso.' })
    expect(rpc).toHaveBeenCalledWith('admin_salvar_integracao_rascunho', expect.objectContaining({
      p_integracao_fundo_id: null,
      p_versao_id: null,
      p_adapter_key: null,
      p_capabilities: [],
      p_endpoint_base: '',
      p_credencial_integracao_id: null,
    }))
  })

  it('usa EDIT no segundo save com a mesma integracao e versao', async () => {
    const result = await salvarIntegracaoRascunhoAdmin({
      ...base,
      integracaoFundoId: integrationId,
      versaoId: versionId,
      systemName: 'PORTAL FIDC AJUSTADO',
    })

    expect(result).toMatchObject({ success: true, message: 'Rascunho atualizado com sucesso.' })
    expect(rpc).toHaveBeenCalledWith('admin_salvar_integracao_rascunho', expect.objectContaining({
      p_integracao_fundo_id: integrationId,
      p_versao_id: versionId,
      p_system_name: 'PORTAL FIDC AJUSTADO',
    }))
  })

  it('deriva o CNPJ financeiro do cadastro do fundo e preserva os demais parametros', async () => {
    const result = await salvarIntegracaoRascunhoAdmin({
      ...base,
      adapterKey: 'sinqia_portal_fidc',
      capabilities: ['ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'],
      configuracaoNaoSensivel: {
        relatorios_financeiros: { intervalo_polling_ms: 5000 },
        parametro_adicional: true,
      },
    })

    expect(result.success).toBe(true)
    expect(from).toHaveBeenCalledWith('fundos')
    expect(rpc).toHaveBeenCalledWith('admin_salvar_integracao_rascunho', expect.objectContaining({
      p_configuracao_nao_sensivel: {
        relatorios_financeiros: {
          intervalo_polling_ms: 5000,
          cnpj_fundo: '68522785000104',
        },
        parametro_adicional: true,
      },
    }))
  })

  it('nao consulta o cadastro do fundo quando o rascunho possui somente cessao', async () => {
    const result = await salvarIntegracaoRascunhoAdmin({
      ...base,
      adapterKey: 'sinqia_portal_fidc',
      capabilities: ['CESSAO_ENVIO'],
    })

    expect(result.success).toBe(true)
    expect(from).not.toHaveBeenCalled()
  })

  it('bloqueia sentinel frontend antes de consultar o Supabase', async () => {
    const result = await salvarIntegracaoRascunhoAdmin({ ...base, integracaoFundoId: 'new' })

    expect(result).toMatchObject({ success: false, message: 'A integracao selecionada e invalida.' })
    expect(requireSuperAdmin).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
