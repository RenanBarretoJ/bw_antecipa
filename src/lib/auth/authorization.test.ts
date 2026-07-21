import { describe, expect, it } from 'vitest'
import type { AppSupabaseClient } from './authorization'
import { AuthorizationError, assertRole, canAccessCedente, isRegisteredStoragePath, requireAuthenticated, requireGestor } from './authorization'

function fakeClient({
  userId,
  role,
}: {
  userId: string | null
  role?: 'gestor' | 'cedente' | 'sacado' | 'consultor'
}): AppSupabaseClient {
  return {
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: role ? { id: userId, role, status: 'ativo', nome_completo: 'Teste', email: 'teste@example.com' } : null,
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as AppSupabaseClient
}

describe('autorização server-side', () => {
  it('recusa usuário não autenticado', async () => {
    await expect(requireAuthenticated(fakeClient({ userId: null }))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    })
  })

  it('recusa cedente na ação exclusiva de gestor', async () => {
    await expect(requireGestor(fakeClient({ userId: 'cedente-1', role: 'cedente' }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
  })

  it('permite gestor autorizado', async () => {
    const context = await requireGestor(fakeClient({ userId: 'gestor-1', role: 'gestor' }))
    expect(context.profile.role).toBe('gestor')
  })

  it('mantém a regra de role explícita para qualquer papel não permitido', () => {
    expect(() => assertRole('sacado', ['gestor'])).toThrowError(AuthorizationError)
    expect(() => assertRole('gestor', ['gestor'])).not.toThrow()
  })

  it('não autoriza cedente em entidade de outro proprietário', () => {
    expect(canAccessCedente({
      role: 'cedente',
      userId: 'user-1',
      ownerUserId: 'user-2',
      hasDelegatedAccess: false,
      hasConsultorLink: false,
    })).toBe(false)
  })
})

describe('registro de arquivos privados', () => {
  it('aceita somente igualdade exata com o path registrado', () => {
    const registered = ['operacoes/op-1/termo.pdf', null]

    expect(isRegisteredStoragePath('operacoes/op-1/termo.pdf', registered)).toBe(true)
    expect(isRegisteredStoragePath('operacoes/op-1/termo.pdf/../../outro.pdf', registered)).toBe(false)
    expect(isRegisteredStoragePath('operacoes/op-10/termo.pdf', registered)).toBe(false)
  })
})
