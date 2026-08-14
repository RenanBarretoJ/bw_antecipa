import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { executarCicloFinanceiro } from './cron.server'
import type { FinancialIntegrationCapability } from '@/lib/integracoes/capabilities'
import type { ResolvedIntegrationVersion } from '@/lib/integracoes/resolver.server'

const fundoId = '11111111-1111-4111-8111-111111111111'

function integrationVersion(capability: FinancialIntegrationCapability): ResolvedIntegrationVersion {
  return {
    fundoId,
    integrationId: '22222222-2222-4222-8222-222222222222',
    integrationVersionId: `33333333-3333-4333-8333-${capability.padEnd(12, '0').slice(0, 12)}`,
    providerKey: capability === 'CARTEIRA' ? 'QA_B' : 'QA_A',
    systemName: capability === 'CARTEIRA' ? 'Sistema B' : 'Sistema A',
    adapterKey: capability === 'CARTEIRA' ? 'qa_b' : 'qa_a',
    environment: 'homologacao',
    capability,
    version: 1,
    endpointBase: 'https://qa.invalid',
    clientIdentifier: '',
    originatorCode: null,
    credentialReference: '',
    credentialId: '',
    config: {},
  }
}

function supabaseStub() {
  const updates: Array<Record<string, unknown>> = []
  return {
    updates,
    client: {
      from(table: string) {
        if (table === 'fundos') {
          return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: [{ id: fundoId }], error: null }) }) }
        }
        if (table === 'importacao_ciclos') {
          return {
            update(payload: Record<string, unknown>) {
              updates.push(payload)
              return { eq: vi.fn().mockResolvedValue({ error: null }) }
            },
          }
        }
        throw new Error(`Tabela inesperada no teste: ${table}`)
      },
      rpc: vi.fn().mockResolvedValue({ data: '44444444-4444-4444-8444-444444444444', error: null }),
    },
  }
}

describe('cron financeiro por capability', () => {
  beforeEach(() => {
    process.env.INTEGRATION_RUNTIME_ENV = 'homologacao'
  })

  it('resolve as quatro familias independentemente e preserva D-1/D-2', async () => {
    const supabase = supabaseStub()
    const resolve = vi.fn(async ({ capability }: { capability: FinancialIntegrationCapability }) => ({
      status: 'CONFIGURADA' as const,
      integrationVersion: integrationVersion(capability),
    }))
    const handler = (adapterKey: string, capability: FinancialIntegrationCapability) => ({
      adapterKey,
      capability,
      obterArquivo: vi.fn().mockResolvedValue({
        fundoId,
        provedor: capability === 'CARTEIRA' ? 'QA_B' : 'QA_A',
        tipoBase: capability,
        dataReferencia: capability === 'CARTEIRA' ? '2026-08-06' : '2026-08-07',
        nomeArquivo: `${capability.toLowerCase()}.csv`,
        mimeType: 'text/csv',
        conteudo: new Uint8Array([1]),
      }),
    })
    const handlers = {
      get: vi.fn((adapterKey: string, capability: FinancialIntegrationCapability) => handler(adapterKey, capability)),
    }
    const ingest = vi.fn().mockResolvedValue({ importacaoId: crypto.randomUUID(), status: 'VALIDA', duplicada: false, resultado: {} })
    const publish = vi.fn().mockResolvedValue({})

    const result = await executarCicloFinanceiro('2026-08-10', {
      supabase: supabase.client as never,
      resolve: resolve as never,
      handlers,
      ingest: ingest as never,
      publish,
    })

    expect(resolve.mock.calls.map(([input]) => input.capability)).toEqual(['ESTOQUE', 'AQUISICOES', 'LIQUIDACOES', 'CARTEIRA'])
    expect(ingest).toHaveBeenCalledTimes(4)
    expect(ingest.mock.calls[0][0]).toHaveProperty('integracaoFundoVersaoId')
    expect(result).toMatchObject({ arquivos: 4, publicados: 4, falhas: 0 })
    expect(supabase.updates[0]).toMatchObject({ status: 'CONCLUIDO', falhas: 0 })
  })

  it('registra falha parcial sem procurar outro adapter', async () => {
    const supabase = supabaseStub()
    const resolve = vi.fn(async ({ capability }: { capability: FinancialIntegrationCapability }) => ({
      status: 'CONFIGURADA' as const,
      integrationVersion: integrationVersion(capability),
    }))
    const handlers = {
      get: vi.fn((adapterKey: string, capability: FinancialIntegrationCapability) => ({
        adapterKey,
        capability,
        obterArquivo: capability === 'CARTEIRA'
          ? vi.fn().mockRejectedValue(new Error('provider indisponivel'))
          : vi.fn().mockResolvedValue({
              fundoId,
              provedor: 'QA_A',
              tipoBase: capability,
              dataReferencia: '2026-08-07',
              nomeArquivo: `${capability.toLowerCase()}.csv`,
              mimeType: 'text/csv',
              conteudo: new Uint8Array([1]),
            }),
      })),
    }
    const ingest = vi.fn().mockResolvedValue({ importacaoId: crypto.randomUUID(), status: 'PUBLICADA', duplicada: false, resultado: {} })

    const result = await executarCicloFinanceiro('2026-08-10', {
      supabase: supabase.client as never,
      resolve: resolve as never,
      handlers,
      ingest: ingest as never,
      publish: vi.fn(),
    })

    expect(result).toMatchObject({ publicados: 3, falhas: 1 })
    expect(resolve).toHaveBeenCalledTimes(4)
    expect(handlers.get).toHaveBeenCalledTimes(4)
    expect(supabase.updates[0].status).toBe('PARCIAL')
    expect(supabase.updates[0].detalhes).toMatchObject({ resumo: '3/4 fontes disponiveis' })
  })
})
