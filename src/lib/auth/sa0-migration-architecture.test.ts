import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const enumMigration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260812115900_sa0_super_admin_enum.sql'), 'utf8')
const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260812120000_sa0_super_admin_roles.sql'), 'utf8')

describe('migration SA0', () => {
  it('cria papel complementar com RLS de leitura propria e sem mutacao autenticada', () => {
    expect(enumMigration).toContain("ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'super_admin'")
    expect(migration).not.toContain('ALTER TYPE public.user_role ADD VALUE')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.usuario_papeis')
    expect(migration).toContain('USING (usuario_id = (SELECT auth.uid()))')
    expect(migration).toContain('REVOKE ALL ON TABLE public.usuario_papeis FROM anon, authenticated')
    expect(migration).toContain('GRANT SELECT ON TABLE public.usuario_papeis TO authenticated')
  })

  it('nao altera get_user_role nem concede bypass operacional ao Super Admin', () => {
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.get_user_role')
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]*super_admin[\s\S]*ON public\.(fundos|operacoes|notas_fiscais)/i)
  })

  it('bloqueia troca do papel primario pelo proprio usuario', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.proteger_papel_primario_profile()')
    expect(migration).toContain("COALESCE(auth.role(), '') <> 'service_role'")
    expect(migration).not.toContain('GRANT UPDATE (role) ON TABLE public.profiles TO authenticated')
  })

  it('nao transforma metadata editavel do Auth em papel administrativo', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.handle_new_user()')
    expect(migration).toContain("v_role_metadata IN ('gestor', 'cedente', 'sacado', 'consultor')")
    expect(migration).toContain("IF NEW.role::text <> 'super_admin' THEN")
    expect(migration).toContain("WHERE p.role::text <> 'super_admin'")
  })

  it('mantem trilha administrativa minima isolada', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.plataforma_auditoria')
    expect(migration).toContain('REVOKE ALL ON TABLE public.plataforma_auditoria FROM anon, authenticated')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.provisionar_super_admin_homolog')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.provisionar_super_admin_homolog(uuid, text) TO service_role')
    expect(migration).toContain("'ator_tecnico', 'bootstrap_service_role'")
    expect(migration).toContain("'ambiente', 'homologacao'")
    expect(migration).toContain("'project_ref', trim(p_project_ref)")
  })
})
