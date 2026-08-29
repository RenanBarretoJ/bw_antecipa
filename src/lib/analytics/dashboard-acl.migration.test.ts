import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260817185117_hotfix_dashboard_gestor_acl.sql',
  'utf8',
)

describe('ACL do dashboard do gestor', () => {
  it('restaura somente a leitura exigida pelas RPCs SECURITY INVOKER', () => {
    expect(migration).toContain('GRANT SELECT ON TABLE public.documentos TO authenticated')
    expect(migration).toContain('GRANT SELECT ON TABLE public.contas_escrow TO authenticated')
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.documentos FROM authenticated')
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.contas_escrow FROM authenticated')
  })

  it('substitui a policy global de documentos por escopo multifundo', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS documentos_gestor_all')
    expect(migration).toContain('CREATE POLICY documentos_gestor_multifundo_select')
    expect(migration).toContain('private.usuario_tem_acesso_fundo(cf.fundo_id)')
    expect(migration).not.toContain('USING (true)')
    expect(migration).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(migration).not.toContain('SECURITY DEFINER')
  })
})
