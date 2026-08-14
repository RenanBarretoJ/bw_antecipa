import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/integracoes/credentials.server', () => ({ resolverCredencialIntegracaoSegura: vi.fn() }))
import { createRlxCapabilityHandlerRegistry, obterArquivoCapabilityComTimeout, RlxProviderTimeoutError, type RlxCapabilityHandler } from './provider'

const integrationVersion = {
  fundoId: crypto.randomUUID(), integrationId: crypto.randomUUID(), integrationVersionId: crypto.randomUUID(),
  providerKey: 'QA', systemName: 'QA', adapterKey: 'qa_adapter', environment: 'homologacao' as const,
  capability: 'ESTOQUE' as const, version: 1, endpointBase: '', clientIdentifier: '', originatorCode: null,
  credentialReference: '', credentialId: '', config: {},
}

const arquivo = {
  fundoId: integrationVersion.fundoId, provedor: 'QA', tipoBase: 'ESTOQUE' as const,
  dataReferencia: '2026-08-07', nomeArquivo: 'estoque.csv', mimeType: 'text/csv', conteudo: new Uint8Array(),
}

describe('handlers financeiros RLX por capability', () => {
  it('resolve cada handler por adapter e capability sem mega-interface', async () => {
    const handler: RlxCapabilityHandler = { adapterKey: 'qa_adapter', capability: 'ESTOQUE', obterArquivo: vi.fn().mockResolvedValue(arquivo) }
    const registry = createRlxCapabilityHandlerRegistry([handler])
    expect(registry.get('qa_adapter', 'ESTOQUE')).toBe(handler)
    expect(registry.get('qa_adapter', 'CARTEIRA')).toBeNull()
    await expect(obterArquivoCapabilityComTimeout(handler, { dataOperacional: '2026-08-10', dataReferencia: '2026-08-07', integrationVersion }, 50)).resolves.toEqual(arquivo)
  })

  it('interrompe somente a capability lenta', async () => {
    const handler: RlxCapabilityHandler = { adapterKey: 'qa_lento', capability: 'ESTOQUE', obterArquivo: () => new Promise(() => undefined) }
    await expect(obterArquivoCapabilityComTimeout(handler, { dataOperacional: '2026-08-10', dataReferencia: '2026-08-07', integrationVersion }, 5)).rejects.toBeInstanceOf(RlxProviderTimeoutError)
  })

  it('rejeita timeout fora do limite defensivo', async () => {
    const handler: RlxCapabilityHandler = { adapterKey: 'qa_adapter', capability: 'ESTOQUE', obterArquivo: vi.fn().mockResolvedValue(arquivo) }
    await expect(obterArquivoCapabilityComTimeout(handler, { dataOperacional: '2026-08-10', dataReferencia: '2026-08-07', integrationVersion }, 0)).rejects.toThrow('Timeout individual')
  })
})
