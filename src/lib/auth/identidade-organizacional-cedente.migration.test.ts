import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260826172150_p1_identidade_organizacional_cedente.sql',
  'utf8',
)
const gestorActions = readFileSync('src/lib/actions/gestor.ts', 'utf8')

describe('P1: identidade organizacional canonica do Cedente', () => {
  it('migra perfis e estados legados para o vocabulario canonico', () => {
    expect(migration).toContain("WHEN 'administrador' THEN 'ADMIN'")
    expect(migration).toContain("WHEN 'operador' THEN 'OPERACIONAL'")
    expect(migration).toContain("CASE WHEN ativo THEN 'ATIVO' ELSE 'REVOGADO' END")
    expect(migration).toContain("CHECK (perfil IN ('ADMIN', 'OPERACIONAL'))")
    expect(migration).toContain("CHECK (status IN ('CONVIDADO', 'ATIVO', 'REVOGADO'))")
  })

  it('garante uma unica associacao por usuario e Cedente', () => {
    expect(migration).toContain(
      'cedente_acessos_user_id_cedente_id_key UNIQUE (user_id, cedente_id)',
    )
  })

  it('faz backfill idempotente do owner legado como ADMIN/ATIVO', () => {
    const backfill = migration.slice(migration.indexOf('INSERT INTO public.cedente_acessos'))
    expect(backfill).toContain("'ADMIN'")
    expect(backfill).toContain("'ATIVO'")
    expect(backfill).toContain('FROM public.cedentes c')
    expect(backfill).toContain('ON CONFLICT (user_id, cedente_id) DO UPDATE')
  })

  it('prioriza associacao ativa, preserva fallback do owner e falha fechada em ambiguidade', () => {
    const helper = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.get_user_cedente_id()'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.get_user_cedente_acesso_perfil()'),
    )
    expect(helper).toContain("ca.status = 'ATIVO'")
    expect(helper).toContain('COALESCE(cardinality(v_cedente_ids), 0) > 1')
    expect(helper).toContain("ERRCODE = '21000'")
    expect(helper).toContain('FROM public.cedentes c')
    expect(helper).toContain('NOT EXISTS (')
    expect(helper).not.toContain('LIMIT 1')
  })

  it('OPERACIONAL ativo nao passa pelo helper de ADMIN', () => {
    const adminHelper = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION private.usuario_e_admin_cedente'),
      migration.indexOf('CREATE OR REPLACE FUNCTION private.usuario_e_operacional_cedente'),
    )
    expect(adminHelper).toContain("ca.status = 'ATIVO'")
    expect(adminHelper).toContain("ca.perfil = 'ADMIN'")
    expect(adminHelper).not.toContain("ca.perfil = 'OPERACIONAL'")
  })

  it('cria fundacao de convites sem token em texto puro e sem escrita para authenticated', () => {
    expect(migration).toContain('CREATE TABLE public.cedente_usuario_convites')
    expect(migration).toContain('token_hash text NOT NULL')
    expect(migration).not.toMatch(/\btoken\s+text\b/i)
    expect(migration).toContain('ALTER TABLE public.cedente_usuario_convites ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.cedente_usuario_convites FROM PUBLIC, anon, authenticated',
    )
    expect(migration).toContain('GRANT ALL ON TABLE public.cedente_usuario_convites TO service_role')
  })

  it('preserva o contrato legado na borda publica sem rebaixar o armazenamento canonico', () => {
    expect(migration).toContain("WHEN 'ADMIN' THEN 'administrador'")
    expect(migration).toContain("WHEN 'OPERACIONAL' THEN 'operador'")
    expect(gestorActions).toContain("perfil === 'administrador' ? 'ADMIN' : 'OPERACIONAL'")
    expect(gestorActions).toContain("status: 'ATIVO'")
    expect(gestorActions).toContain("status: 'REVOGADO'")
  })
})
