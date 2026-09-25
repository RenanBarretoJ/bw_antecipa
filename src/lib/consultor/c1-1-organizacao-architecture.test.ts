import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const schema = readFileSync(join(root, 'supabase/migrations/20260925144545_c1_1_organizacao_consultora_schema.sql'), 'utf8')
const authz = readFileSync(join(root, 'supabase/migrations/20260925144547_c1_1_autorizacao_organizacional.sql'), 'utf8')
const admin = readFileSync(join(root, 'supabase/migrations/20260925144549_c1_1_admin_consultorias_convites.sql'), 'utf8')

describe('C1.1 organization-centric authorization architecture', () => {
  it('models organization, memberships, Funds and portfolio without per-user duplication', () => {
    expect(schema).toContain('CREATE TABLE public.consultores')
    expect(schema).toContain('CREATE TABLE public.consultor_usuarios')
    expect(schema).toContain('CREATE TABLE public.consultor_fundos')
    expect(schema).toContain('CREATE TABLE public.consultor_cedentes')
    expect(schema).toContain('UNIQUE (consultor_id, cedente_id)')
    expect(schema).toContain("papel IN ('OWNER', 'ADMIN', 'OPERADOR', 'LEITOR')")
  })

  it('centralizes C2/C3/C4 in organization predicates and freezes the legacy table', () => {
    expect(authz).toContain('private.consultor_usuario_pode_gerenciar_cedente')
    expect(authz).toContain('private.consultor_usuario_pode_operar_cedente')
    expect(authz).toContain("cu.papel IN ('OWNER', 'ADMIN', 'OPERADOR')")
    expect(authz).toContain('REVOKE ALL ON TABLE public.consultor_cedente FROM anon, authenticated')
    expect(authz).toContain('consultor_listar_cedente_ids_operacionais')
  })

  it('keeps Fund authority and additional invitations with Super Admin in this phase', () => {
    expect(admin).toContain('private.c1_1_exigir_super_admin')
    expect(admin).toContain('admin_atualizar_fundos_consultoria')
    expect(admin).toContain("v_papel NOT IN ('ADMIN', 'OPERADOR', 'LEITOR')")
    expect(admin).toContain('O papel OWNER nao pode ser transferido nesta fase.')
  })

  it('removes direct runtime reads from the historical user-centric portfolio', () => {
    const runtimeFiles = [
      'src/lib/actions/selectors.ts',
      'src/lib/auth/authorization.ts',
      'src/lib/escrow/listagem.server.ts',
      'src/lib/escrow/movimentos.server.ts',
      'src/lib/operacoes/listagem.server.ts',
      'src/lib/operacoes/solicitante.server.ts',
    ]
    for (const file of runtimeFiles) {
      expect(readFileSync(join(root, file), 'utf8')).not.toContain("from('consultor_cedente')")
    }
  })
})
