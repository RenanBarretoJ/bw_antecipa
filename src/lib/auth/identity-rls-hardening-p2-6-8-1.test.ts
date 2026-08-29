import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260817204159_p2_6_8_1_hardening_rls_identidade_profiles.sql',
  'utf8',
)
const apiWorker = readFileSync(
  'scripts/homologacao/financeiro/readiness/p2-6-5-api-worker.mjs',
  'utf8',
)

describe('P2.6.8.1 hardening RLS de identidade', () => {
  it('remove a policy ALL global de gestor sem recria-la', () => {
    expect(migration).toContain('DROP POLICY profiles_gestor_all ON public.profiles')
    expect(migration).not.toMatch(/CREATE POLICY\s+profiles_gestor_all/i)
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+FOR ALL[\s\S]+get_user_role\(\)[\s\S]+gestor/i)
  })

  it('preserva somente SELECT autenticado e leitura own-row', () => {
    expect(migration).toContain('GRANT SELECT ON TABLE public.profiles TO authenticated')
    expect(migration).toContain('GRANT SELECT ON TABLE public.usuario_papeis TO authenticated')
    expect(migration).toContain("policyname = 'profiles_own_select'")
    expect(migration).toContain("policyname = 'usuario_papeis_select_own'")
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.usuario_papeis FROM PUBLIC, anon, authenticated')
    expect(migration).not.toContain('USING (true)')
  })

  it('mantem regressao permanente de leitura e mutacao cross-user', () => {
    for (const action of ['SELECT_OWN', 'SELECT_OTHER', 'INSERT_OTHER', 'UPDATE_OTHER', 'DELETE_OTHER']) {
      expect(apiWorker).toContain(`action: '${action}'`)
    }
    for (const action of ['INSERT_DIRECT', 'UPDATE_DIRECT', 'DELETE_DIRECT']) {
      expect(apiWorker).toContain(`action: '${action}'`)
    }
    for (const actor of ['GESTOR_A', 'CEDENTE_A', 'CONSULTOR_A', 'SACADO_A', 'SUPER_ADMIN_PURO', 'SUPER_ADMIN_GESTOR_A']) {
      expect(apiWorker).toContain(`'${actor}'`)
    }
  })
})
