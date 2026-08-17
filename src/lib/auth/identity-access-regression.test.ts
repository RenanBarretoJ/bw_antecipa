import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { loadSessionProfile } from './identity-query'
import { listarPapeisAtivosUsuario } from './platform-access'

const migration = readFileSync(
  'supabase/migrations/20260817182112_hotfix_restaurar_leitura_identidade_autenticada.sql',
  'utf8',
)

function profileClient(result: { data: unknown; error: unknown }) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => result,
  }
  return { from: () => query } as unknown as SupabaseClient<Database>
}

function rolesClient(result: { data: unknown; error: unknown }) {
  const query = {
    select: () => query,
    eq: () => query,
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
  return { from: () => query } as unknown as SupabaseClient<Database>
}

describe('regressao de bootstrap da identidade autenticada', () => {
  afterEach(() => vi.restoreAllMocks())

  it('restaura somente SELECT e mantem own-row RLS para profiles e usuario_papeis', () => {
    expect(migration).toContain('GRANT SELECT ON TABLE public.profiles TO authenticated')
    expect(migration).toContain('USING (id = (SELECT auth.uid()))')
    expect(migration).toContain('GRANT SELECT ON TABLE public.usuario_papeis TO authenticated')
    expect(migration).toContain('USING (usuario_id = (SELECT auth.uid()))')
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.usuario_papeis FROM anon')
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.usuario_papeis FROM authenticated')
    expect(migration).not.toContain('USING (true)')
    expect(migration).not.toContain('DISABLE ROW LEVEL SECURITY')
  })

  it('distingue falha da query de profile de profile ausente', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(loadSessionProfile(profileClient({
      data: null,
      error: { code: '42501', message: 'permission denied for table profiles' },
    }), 'user-a')).rejects.toMatchObject({
      diagnosticCode: 'PROFILE_QUERY_FAILED',
      databaseCode: '42501',
    })

    await expect(loadSessionProfile(profileClient({ data: null, error: null }), 'user-a')).resolves.toBeNull()
  })

  it('carrega papeis ativos depois do sign-in e distingue erro da Data API', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(listarPapeisAtivosUsuario(rolesClient({
      data: [{ papel: 'gestor' }, { papel: 'super_admin' }],
      error: null,
    }), 'user-a', 'gestor')).resolves.toEqual(['gestor', 'super_admin'])

    await expect(listarPapeisAtivosUsuario(rolesClient({
      data: null,
      error: { code: '42501', message: 'permission denied for table usuario_papeis' },
    }), 'user-a', 'gestor')).rejects.toMatchObject({
      diagnosticCode: 'USER_ROLES_QUERY_FAILED',
      databaseCode: '42501',
    })
  })
})
