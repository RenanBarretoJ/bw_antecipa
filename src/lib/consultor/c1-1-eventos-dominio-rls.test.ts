import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260925200959_c1_1_eventos_dominio_consultor.sql'),
  'utf8',
)

describe('C1.1 consultant domain-event RLS hotfix', () => {
  it('adds authenticated SELECT and INSERT policies without replacing other actor policies', () => {
    expect(migration).toContain('CREATE POLICY eventos_dominio_consultor_select')
    expect(migration).toContain('CREATE POLICY eventos_dominio_consultor_insert')
    expect(migration).toContain('FOR SELECT\n  TO authenticated')
    expect(migration).toContain('FOR INSERT\n  TO authenticated')
    expect(migration).not.toContain('DROP POLICY IF EXISTS eventos_dominio_insert')
  })

  it('delegates role, membership, organization, portfolio and Fund status to canonical predicates', () => {
    expect(migration).toContain("(SELECT public.get_user_role()) = 'consultor'")
    expect(migration).toContain('private.consultor_tem_acesso_cedente(cedente_id)')
    expect(migration).toContain('private.consultor_tem_acesso_fundo(fundo_id)')
    expect(migration).toContain("visibilidade IN ('cedente', 'ambos')")
    expect(migration).not.toContain('consultor_cedente ')
  })

  it('binds the individual actor and all resource identifiers to the authorized context', () => {
    expect(migration).toContain('ator_usuario_id = (SELECT auth.uid())')
    expect(migration).toContain('cf.id = eventos_dominio.cedente_fundo_id')
    expect(migration).toContain('cf.fundo_id = eventos_dominio.fundo_id')
    expect(migration).toContain('nf.id = eventos_dominio.nota_fiscal_id')
    expect(migration).toContain('nf.cedente_id = eventos_dominio.cedente_id')
    expect(migration).toContain('op.id = eventos_dominio.operacao_id')
    expect(migration).toContain('op.cedente_id = eventos_dominio.cedente_id')
  })
})
