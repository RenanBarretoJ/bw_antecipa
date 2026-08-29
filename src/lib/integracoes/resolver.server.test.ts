import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    throw new Error('O teste deve fornecer um cliente explicito.')
  },
}))

import { resolverIntegracaoPorCapability } from './resolver.server'
import { integrationProviderRegistry } from './registry.server'

const fundoId = '11111111-1111-4111-8111-111111111111'

function client(data: unknown, error: { message: string } | null = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) }
}

function configured(overrides: Record<string, unknown> = {}) {
  return {
    status: 'CONFIGURADA',
    fundo_id: fundoId,
    integracao_fundo_id: '22222222-2222-4222-8222-222222222222',
    integracao_fundo_versao_id: '33333333-3333-4333-8333-333333333333',
    provider_key: 'SINQIA',
    system_name: 'Portal FIDC',
    adapter_key: 'sinqia_portal_fidc',
    ambiente: 'homologacao',
    capability: 'CESSAO_ENVIO',
    versao: 1,
    endpoint_base: 'https://portal.example.test',
    identificador_cliente: 'cliente',
    codigo_originador: '000000500497',
    configuracao_nao_sensivel: { modo: 'CNAB' },
    credential_ref: 'credencial:33333333-3333-4333-8333-333333333334',
    credencial_integracao_id: '33333333-3333-4333-8333-333333333334',
    ...overrides,
  }
}

describe('resolvedor canonico de integracoes por capability', () => {
  it('resolve por fundo, ambiente e capability exatos', async () => {
    const rpcClient = client(configured())
    const result = await resolverIntegracaoPorCapability({
      fundoId,
      ambiente: 'homologacao',
      capability: 'CESSAO_ENVIO',
    }, rpcClient)

    expect(rpcClient.rpc).toHaveBeenCalledWith('resolver_integracao_por_capability', {
      p_fundo_id: fundoId,
      p_ambiente: 'homologacao',
      p_capability: 'CESSAO_ENVIO',
    })
    expect(result).toMatchObject({
      status: 'CONFIGURADA',
      integrationVersion: {
        fundoId,
        providerKey: 'SINQIA',
        systemName: 'Portal FIDC',
        adapterKey: 'sinqia_portal_fidc',
        capability: 'CESSAO_ENVIO',
      },
    })
  })

  it('falha fechada sem fonte e nao procura outro ambiente ou fundo', async () => {
    const rpcClient = client({ status: 'NAO_CONFIGURADA', motivo: 'CAPABILITY_SEM_FONTE' })
    await expect(resolverIntegracaoPorCapability({ fundoId, ambiente: 'producao', capability: 'ESTOQUE' }, rpcClient))
      .resolves.toEqual({ status: 'NAO_CONFIGURADA', reason: 'CAPABILITY_SEM_FONTE' })
    expect(rpcClient.rpc).toHaveBeenCalledTimes(1)
  })

  it('nao substitui credencial revogada por outra credencial', async () => {
    const rpcClient = client({ status: 'INDISPONIVEL', motivo: 'CREDENCIAL_INDISPONIVEL' })
    await expect(resolverIntegracaoPorCapability({ fundoId, ambiente: 'homologacao', capability: 'CESSAO_ENVIO' }, rpcClient))
      .resolves.toEqual({ status: 'INDISPONIVEL', reason: 'CREDENCIAL_INDISPONIVEL' })
    expect(rpcClient.rpc).toHaveBeenCalledTimes(1)
  })

  it('aceita credencial ausente somente no modo legado env de cessao', async () => {
    const legacy = await resolverIntegracaoPorCapability(
      { fundoId: '7a114257-7816-468e-adf4-d796b93364df', ambiente: 'producao', capability: 'CESSAO_ENVIO' },
      client(configured({
        ambiente: 'producao',
        credencial_integracao_id: null,
        credential_ref: 'legacy-env:FROMTIS',
        configuracao_nao_sensivel: { runtime_mode: 'legacy_env_sinqia_terra' },
      })),
    )
    const withoutMode = await resolverIntegracaoPorCapability(
      { fundoId, ambiente: 'producao', capability: 'CESSAO_ENVIO' },
      client(configured({ ambiente: 'producao', credencial_integracao_id: null })),
    )
    const financial = await resolverIntegracaoPorCapability(
      { fundoId, ambiente: 'producao', capability: 'ESTOQUE' },
      client(configured({
        ambiente: 'producao', capability: 'ESTOQUE', credencial_integracao_id: null,
        configuracao_nao_sensivel: { runtime_mode: 'legacy_env_sinqia_terra' },
      })),
    )

    expect(legacy.status).toBe('CONFIGURADA')
    expect(withoutMode).toEqual({ status: 'INDISPONIVEL', reason: 'CREDENCIAL_INDISPONIVEL' })
    expect(financial).toEqual({ status: 'INDISPONIVEL', reason: 'CREDENCIAL_INDISPONIVEL' })
  })

  it('bloqueia adapter ausente ou capability nao implementada', async () => {
    const absent = await resolverIntegracaoPorCapability(
      { fundoId, ambiente: 'homologacao', capability: 'ESTOQUE' },
      client(configured({ adapter_key: 'qa_inexistente', capability: 'ESTOQUE' })),
    )
    const unsupported = await resolverIntegracaoPorCapability(
      { fundoId, ambiente: 'homologacao', capability: 'CARTEIRA' },
      client(configured({ capability: 'CARTEIRA' })),
    )
    expect(absent).toEqual({ status: 'INDISPONIVEL', reason: 'ADAPTER_NAO_IMPLEMENTADO' })
    expect(unsupported).toEqual({ status: 'INDISPONIVEL', reason: 'CAPABILITY_NAO_SUPORTADA_PELO_ADAPTER' })
  })

  it('registra somente os adapters reais atualmente implementados', () => {
    expect(integrationProviderRegistry.list()).toEqual([
      expect.objectContaining({ key: 'sinqia_portal_fidc', supports: ['CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'] }),
      expect.objectContaining({ key: 'vortx_vrs', supports: ['CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'] }),
    ])
    expect(integrationProviderRegistry.get('vortx')).toBeNull()
    expect(integrationProviderRegistry.get('portal_custodia')).toBeNull()
  })
})
