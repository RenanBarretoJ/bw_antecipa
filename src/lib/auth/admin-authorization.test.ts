import { describe, expect, it, vi } from 'vitest'
import type { AppSupabaseClient } from './authorization'
import { requireSuperAdmin } from './admin-authorization'

vi.mock('server-only', () => ({}))

function fakeAdminClient({ admin }: { admin: boolean }): AppSupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    rpc: async () => ({ data: [{ status: 'valid' }], error: null }),
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'user-1', role: 'gestor', status: 'ativo', nome_completo: 'Admin', email: 'admin@example.com' }, error: null }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: admin ? [{ papel: 'super_admin' }] : [{ papel: 'gestor' }], error: null }),
          }),
        }),
      }
    },
  } as unknown as AppSupabaseClient
}

describe('guard server-side do Super Admin', () => {
  it('permite usuario com papel complementar ativo', async () => {
    const context = await requireSuperAdmin(fakeAdminClient({ admin: true }))
    expect(context.roles).toContain('super_admin')
  })

  it('recusa gestor sem papel administrativo', async () => {
    await expect(requireSuperAdmin(fakeAdminClient({ admin: false }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
  })
})
