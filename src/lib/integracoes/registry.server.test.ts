import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createIntegrationProviderRegistry, integrationProviderRegistry, resolverDefinicaoRemessaOperacional } from './registry.server'

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

  it('declara agrupamento no adapter sem impor POR_CEDENTE ao core', () => {
    expect(resolverDefinicaoRemessaOperacional('vortx_vrs')).toMatchObject({
      formato: 'VRS_CSV', estrategiaAgrupamento: 'POR_CEDENTE', envioAutomaticoSuportado: false,
    })
    expect(resolverDefinicaoRemessaOperacional('sinqia_portal_fidc')).toMatchObject({
      formato: 'CNAB444', estrategiaAgrupamento: 'POR_LOTE', envioAutomaticoSuportado: true,
    })
  })

  it('adapter Vortx VRS exige o contrato completo de Inclusao ao publicar CESSAO_ENVIO', () => {
    const adapter = integrationProviderRegistry.get('vortx_vrs')
    expect(adapter?.validatePublication({ capabilities: [], clientIdentifier: '', originatorCode: null, config: {} })).toBeNull()
    expect(adapter?.validatePublication({ capabilities: ['CESSAO_ENVIO'], clientIdentifier: '', originatorCode: null, config: {} })).toMatch(/carteira/)
    expect(adapter?.validatePublication({ capabilities: ['CESSAO_ENVIO'], clientIdentifier: '', originatorCode: null, config: {
      codigo_carteira: 'CART01',
      vrs_inclusao: { termo: 'TERMO1', cnpj_originador: '12345678000195', tipo_preco: 'PREFIXADO', metodo_preco: 'PREFIXADO', modalidade_operacao: '0202', registradora: 'CERC' },
    } })).toBeNull()
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
