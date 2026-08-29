import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260827203000_p2_runtime_compatibilidade_sacado_admin.sql'), 'utf8')
const notificationsMigration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260827204000_p2_runtime_notificacoes_authenticated.sql'), 'utf8')
const authProfileMigration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260827205000_p2_runtime_restaurar_trigger_profile_auth.sql'), 'utf8')

describe('P2 runtime compatibility migration', () => {
  it('restaura somente leitura autenticada de sacados com RLS own-row', () => {
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.sacados FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT SELECT ON TABLE public.sacados TO authenticated')
    expect(migration).toContain('TO authenticated')
    expect(migration).toContain('(SELECT auth.uid()) = user_id')
  })

  it('materializa os campos estruturais usados pelas RPCs SA1', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS administradora_endereco text')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS contato_email text')
  })
})

describe('P2 runtime notifications compatibility', () => {
  it('restaura apenas leitura e atualizacao autenticadas protegidas por auth.uid()', () => {
    expect(notificationsMigration).toContain('GRANT SELECT, UPDATE ON TABLE public.notificacoes TO authenticated')
    expect(notificationsMigration).toContain('TO authenticated')
    expect(notificationsMigration).toContain('(SELECT auth.uid()) = usuario_id')
    expect(notificationsMigration).not.toContain('GRANT INSERT ON TABLE public.notificacoes TO authenticated')
    expect(notificationsMigration).not.toContain('GRANT DELETE ON TABLE public.notificacoes TO authenticated')
  })
})

describe('P2 runtime Auth profile compatibility', () => {
  it('restaura o trigger seguro de profile sem aceitar super_admin da metadata', () => {
    expect(authProfileMigration).toContain('AFTER INSERT ON auth.users')
    expect(authProfileMigration).toContain('EXECUTE FUNCTION public.handle_new_user()')
    expect(authProfileMigration).not.toContain("'super_admin'::public.user_role")
  })
})
