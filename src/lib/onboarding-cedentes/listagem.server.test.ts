import { describe, expect, it } from 'vitest'
import { normalizarPayloadOnboarding } from './listagem'

describe('onboarding cedentes compact RPC contract', () => {
  it('normalizes malformed counters without inventing rows', () => {
    expect(normalizarPayloadOnboarding({
      items: null,
      total: '12',
      counts: { pendencias: 3, todos: '12' },
    })).toEqual({
      items: [],
      total: 12,
      counts: {
        pendencias: 3,
        sem_fundo: 0,
        sem_politica: 0,
        aptos: 0,
        suspensos: 0,
        todos: 12,
      },
    })
  })

  it('preserves only the compact page items returned by the RPC', () => {
    const item = {
      id: '00000000-0000-0000-0000-000000000001',
      razaoSocial: 'Cedente',
      nomeFantasia: null,
      cnpj: '12345678000190',
      statusCadastral: 'ativo',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
      onboardingStatus: 'aguardando_vinculo_fundo',
      vinculo: null,
      fundo: null,
      politica: null,
    }
    const result = normalizarPayloadOnboarding({
      items: [item],
      total: 1,
      counts: { pendencias: 1, sem_fundo: 1, todos: 1 },
    })
    expect(result.items).toEqual([item])
    expect(result.total).toBe(1)
  })
})
