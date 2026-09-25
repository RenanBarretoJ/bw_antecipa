import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260925204922_c1_1_reconciliar_documentos_consultor.sql',
  'utf8',
)

describe('C1.1 hotfix: reconciliacao documental do Consultor', () => {
  it('inclui o Consultor na fronteira sem ampliar acesso anonimo', () => {
    expect(migration).toContain("actor_role NOT IN ('gestor', 'cedente', 'consultor')")
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.reconciliar_documentos_base_nf(uuid) FROM PUBLIC, anon',
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.reconciliar_documentos_base_nf(uuid) TO authenticated',
    )
  })

  it('exige acesso operacional ao Cedente e ao Fundo para o Consultor', () => {
    expect(migration).toContain('private.usuario_pode_operar_cedente(nf_context.cedente_id)')
    expect(migration).toContain('private.consultor_tem_acesso_fundo(nf_context.fundo_id)')
    expect(migration).toContain("RAISE EXCEPTION 'Consultor sem acesso operacional a nota fiscal'")
  })

  it('mantem o isolamento do Cedente e nao aceita LEITOR', () => {
    expect(migration).toContain("actor_role = 'cedente'")
    expect(migration).toContain('nf_context.cedente_id <> get_user_cedente_id()')
    expect(migration).not.toContain("'leitor'")
  })
})
