import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260922161558_reconcile_runtime_policies_reset_functions_grants.sql',
  ),
  'utf8',
).toLowerCase()

describe('forward reconciliation do schema de runtime', () => {
  it('nao depende da identidade do ambiente nem altera migration history', () => {
    expect(migration).not.toContain('current_database()')
    expect(migration).not.toContain('fhgkmggthxikfpogrvaa')
    expect(migration).not.toContain('supabase_migrations.schema_migrations')
    expect(migration).not.toContain('migration repair')
  })

  it('remove somente as quatro policies legadas conhecidas', () => {
    for (const policy of [
      'ca_gestor_all',
      'notificacoes_gestor_all',
      'sacados_gestor_all',
      'testemunhas_gestor_all',
    ]) {
      expect(migration).toContain(`drop policy if exists ${policy}`)
    }
  })

  it('restaura as policies runtime com role autenticada e auth.uid escalar', () => {
    expect(migration).toContain('create policy sacados_own_select')
    expect(migration).toContain('create policy notificacoes_own_select')
    expect(migration).toContain('create policy notificacoes_own_update')
    expect(migration).toContain("roles = array['authenticated']::name[]")
    expect(migration).toContain('using ((select auth.uid()) = user_id)')
    expect(migration).toContain('using ((select auth.uid()) = usuario_id)')
  })

  it('concede apenas os grants runtime canonicos e preserva RLS', () => {
    expect(migration).toContain('grant select on table public.sacados to authenticated')
    expect(migration).toContain('grant select, update on table public.notificacoes to authenticated')
    expect(migration).not.toMatch(/grant\s+all\s+on/u)
    expect(migration).not.toContain('disable row level security')
    expect(migration).toContain('not c.relrowsecurity or c.relforcerowsecurity')
  })

  it('remove helpers nao canonicos com RESTRICT e sem CASCADE', () => {
    expect(migration).toContain("p.proname like 'reset_operacional_fundo_homolog%'")
    expect(migration).toContain("p.proname = 'excluir_usuarios_homolog'")
    expect(migration).toContain("execute format('drop function %s restrict', v_function)")
    expect(migration).not.toContain('drop function %s cascade')
  })

  it('falha fechado em assinatura inesperada e valida o trigger Auth', () => {
    expect(migration).toContain('overload(s) de reset inesperado(s)')
    expect(migration).toContain('assinatura inesperada de excluir_usuarios_homolog')
    expect(migration).toContain("t.tgname = 'on_auth_user_created'")
    expect(migration).toContain("v_trigger_type <> 5")
    expect(migration).toContain("array['search_path=public']::text[]")
  })
})
