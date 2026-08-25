import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createIntegrationProviderRegistry, integrationProviderRegistry } from './registry.server'

describe('integrationProviderRegistry', () => {
  it('registra os adapters Sinqia e Vortx VRS somente para capacidades com handler comprovado', () => {
    expect(integrationProviderRegistry.list().map(({ key, supports }) => ({ key, supports }))).toEqual([
      { key: 'sinqia_portal_fidc', supports: ['CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'] },
      { key: 'vortx_vrs', supports: ['CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'] },
    ])
    expect(integrationProviderRegistry.supports('sinqia_portal_fidc', 'ESTOQUE')).toBe(true)
    expect(integrationProviderRegistry.supports('sinqia_portal_fidc', 'CARTEIRA')).toBe(false)
    expect(integrationProviderRegistry.supports('vortx_vrs', 'LIQUIDACOES')).toBe(true)
    expect(integrationProviderRegistry.supports('vortx_vrs', 'CARTEIRA')).toBe(false)
  })

  it('adapter Vortx VRS nao usa o fluxo generico de credencial/endpoint (vive em tabela propria)', () => {
    const adapter = integrationProviderRegistry.get('vortx_vrs')
    expect(adapter?.requiresCredential).toBe(false)
    expect(adapter?.requiresEndpoint).toBe(false)
  })

  it('adapter Vortx VRS rejeita codigo de carteira invalido mas aceita ausente ou UUID valido', () => {
    const adapter = integrationProviderRegistry.get('vortx_vrs')
    expect(adapter?.validatePublication({ capabilities: [], clientIdentifier: '', originatorCode: null, config: {} })).toBeNull()
    expect(adapter?.validatePublication({ capabilities: [], clientIdentifier: '', originatorCode: null, config: { codigo_carteira: '11111111-1111-1111-1111-111111111111' } })).toBeNull()
    expect(adapter?.validatePublication({ capabilities: [], clientIdentifier: '', originatorCode: null, config: { codigo_carteira: 'abc123' } })).toMatch(/invalido/)
  })

  it('adapter Vortx VRS direciona o teste tecnico generico para o fluxo dedicado mTLS', async () => {
    const adapter = integrationProviderRegistry.get('vortx_vrs')
    const result = await adapter?.testConnection({ endpoint: '', username: '', password: '', timeoutMs: 100 })
    expect(result?.ok).toBe(false)
    expect(result?.message).toMatch(/dedicado/)
  })

  it('delega o teste tecnico ao adapter e nao a um switch por provider', async () => {
    const testConnection = vi.fn().mockResolvedValue({ ok: true, statusCode: '200', message: 'ok', errorCategory: '' })
    const registry = createIntegrationProviderRegistry([{
      key: 'qa',
      label: 'QA',
      supports: ['ESTOQUE'],
      deliveryMethods: {},
      requiresCredential: false,
      requiresEndpoint: false,
      validatePublication: () => null,
      testConnection,
    }])

    const adapter = registry.get('qa')
    await adapter?.testConnection({ endpoint: 'https://qa.invalid', username: '', password: '', timeoutMs: 100 })
    expect(testConnection).toHaveBeenCalledOnce()
  })
})
