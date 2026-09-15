import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260915175435_p7_4_1_rls_importacoes_financeiras_gestor.sql'),
  'utf8',
).toLowerCase()

const policyStart = migration.indexOf('create policy importacoes_gestor_fundo_select')
const policyEnd = migration.indexOf('end if;', policyStart)
const policy = migration.slice(policyStart, policyEnd)

describe('P7.4.1 - RLS de importacoes financeiras para Gestor', () => {
  it('preserva a policy preexistente de Super Admin', () => {
    expect(migration).not.toContain('drop policy')
    expect(migration).not.toContain('alter policy importacoes_super_admin_select')
  })

  it('autoriza somente SELECT para Gestor autenticado', () => {
    expect(policy).toContain('for select')
    expect(policy).toContain('to authenticated')
    expect(policy).not.toMatch(/for\s+(insert|update|delete|all)/)
  })

  it('reutiliza o helper financeiro canonico por fundo', () => {
    expect(policy).toContain('private.financeiro_gestor_tem_acesso_fundo(fundo_id)')
    expect(migration).not.toContain('create or replace function')
  })

  it('nao cria acesso por role global sem vinculo de fundo', () => {
    expect(policy).not.toContain('get_user_role')
    expect(policy).not.toContain("role::text = 'gestor'")
    expect(policy).not.toContain('using (true)')
  })

  it('nao concede acesso cross-fund ao Gestor', () => {
    expect(policy).toContain('(fundo_id)')
    expect(policy).not.toContain('is not null')
  })

  it('nao concede leitura ao Cedente', () => {
    expect(policy).not.toContain('cedente')
  })

  it('nao concede leitura ao Consultor', () => {
    expect(policy).not.toContain('consultor')
  })

  it('nao concede leitura ao Sacado', () => {
    expect(policy).not.toContain('sacado')
  })

  it('mantem anon sem leitura', () => {
    expect(policy).not.toContain('to anon')
    expect(migration).toContain("has_table_privilege('anon', 'public.importacoes_financeiras', 'select')")
  })

  it('nao amplia INSERT, UPDATE ou DELETE de authenticated', () => {
    expect(migration).not.toMatch(/grant\s+(?:select\s*,\s*)?(?:insert|update|delete)/)
    expect(migration).toContain("has_table_privilege('authenticated', 'public.importacoes_financeiras', 'insert')")
    expect(migration).toContain("has_table_privilege('authenticated', 'public.importacoes_financeiras', 'update')")
    expect(migration).toContain("has_table_privilege('authenticated', 'public.importacoes_financeiras', 'delete')")
  })

  it('falha fechada quando tabela, coluna, helper, RLS ou grants divergem', () => {
    expect(migration).toContain("to_regclass('public.importacoes_financeiras')")
    expect(migration).toContain("attname = 'fundo_id'")
    expect(migration).toContain("to_regprocedure('private.financeiro_gestor_tem_acesso_fundo(uuid)')")
    expect(migration).toContain('c.relrowsecurity')
    expect(migration).toContain("grant select de authenticated ausente")
  })
})
