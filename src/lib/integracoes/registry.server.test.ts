import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createIntegrationProviderRegistry, integrationProviderRegistry } from './registry.server'

describe('integrationProviderRegistry', () => {
  it('registra o adapter Sinqia somente para capacidades com handler comprovado', () => {
    expect(integrationProviderRegistry.list().map(({ key, supports }) => ({ key, supports }))).toEqual([
      { key: 'sinqia_portal_fidc', supports: ['CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'] },
    ])
    expect(integrationProviderRegistry.supports('sinqia_portal_fidc', 'ESTOQUE')).toBe(true)
    expect(integrationProviderRegistry.supports('sinqia_portal_fidc', 'CARTEIRA')).toBe(false)
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
