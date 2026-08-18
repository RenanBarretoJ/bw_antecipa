import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '@/lib/auth/authorization'

const mocks = vi.hoisted(() => ({
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  createAdminClient: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: mocks.createAdminClient,
}))

import { contarNotificacoesDoContext } from './listagem.server'

function createQuery(table: string) {
  const state = { table, filters: [] as Array<[string, unknown]> }
  mocks.queries.push(state)

  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      state.filters.push([column, value])
      return query
    }),
    then: (resolve: (result: { count: number; error: null }) => unknown, reject?: (reason: unknown) => unknown) => {
      const unread = state.filters.some(([column, value]) => column === 'lida' && value === false)
      return Promise.resolve({ count: unread ? 2 : 3, error: null }).then(resolve, reject)
    },
  }

  return query
}

describe('listagem server-side de notificacoes', () => {
  beforeEach(() => {
    mocks.queries.length = 0
    mocks.createAdminClient.mockReset()
    mocks.createAdminClient.mockReturnValue({ from: (table: string) => createQuery(table) })
  })

  it('usa acesso server-side e restringe todas as contagens ao usuario autenticado', async () => {
    const context = { user: { id: '11111111-1111-4111-8111-111111111111' } } as AuthContext

    await expect(contarNotificacoesDoContext(context)).resolves.toEqual({ total: 3, naoLidas: 2 })
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1)
    expect(mocks.queries).toHaveLength(2)
    for (const query of mocks.queries) {
      expect(query.table).toBe('notificacoes')
      expect(query.filters).toContainEqual(['usuario_id', context.user.id])
    }
  })

  it('nao aceita usuario alvo fornecido externamente', () => {
    const source = readFile('src/lib/notificacoes/listagem.server.ts')
    expect(source).toContain(".eq('usuario_id', context.user.id)")
    expect(source).not.toContain('usuarioId: input')
    expect(source).not.toContain("from('profiles')")
  })
})

function readFile(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}
