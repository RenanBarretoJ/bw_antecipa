import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260818191418_p0_onboarding_cedente_rpc_segura.sql'),
  'utf8',
)
const actionFile = readFileSync(resolve(process.cwd(), 'src/lib/actions/cedente.ts'), 'utf8')
const cadastrarCedenteAction = actionFile.split('export async function uploadDocumento')[0]

describe('P0 - onboarding seguro do cedente', () => {
  it('resolve a identidade no banco e nao aceita usuario ou fundo do cliente', () => {
    const allowlist = migration.match(/WHERE chave <> ALL \(ARRAY\[([\s\S]*?)\]::text\[\]\)/)?.[1] ?? ''

    expect(migration).toContain('v_usuario_id uuid := auth.uid()')
    expect(migration).toContain("WHERE chave <> ALL (ARRAY[")
    expect(allowlist).toContain("'representantes'")
    expect(allowlist).not.toContain("'user_id'")
    expect(allowlist).not.toContain("'fundo_id'")
    expect(allowlist).not.toContain("'status'")
    expect(migration).toMatch(/'pendente'::public\.cedente_status,[\s\S]*?NULL/)
    expect(migration).not.toMatch(/p_(?:user|usuario|fundo)_id\s+uuid/i)
  })

  it('restringe a RPC a cedente autenticado ativo', () => {
    expect(migration).toContain("v_papel IS DISTINCT FROM 'cedente'")
    expect(migration).toContain("v_status_perfil IS DISTINCT FROM 'ativo'")
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.concluir_onboarding_cedente(jsonb) FROM PUBLIC")
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.concluir_onboarding_cedente(jsonb) FROM anon")
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.concluir_onboarding_cedente(jsonb) TO authenticated")
  })

  it('mantem cedente e representantes na mesma transacao atomica', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('INSERT INTO public.cedentes')
    expect(migration).toContain('INSERT INTO public.representantes')
    expect(migration).toContain('COMMIT;')
  })

  it('e idempotente e serializa repeticoes concorrentes', () => {
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain("'idempotente', true")
    expect(migration).toContain("'criado', false")
  })

  it('nao reabre escrita direta nas tabelas cadastrais', () => {
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.cedentes FROM authenticated')
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.representantes FROM authenticated')
    expect(migration).not.toContain('GRANT INSERT ON TABLE public.cedentes TO authenticated')
    expect(migration).not.toContain('GRANT INSERT ON TABLE public.representantes TO authenticated')
  })

  it('server action usa somente a RPC para persistir o cadastro', () => {
    expect(cadastrarCedenteAction).toContain(".rpc('concluir_onboarding_cedente'")
    expect(cadastrarCedenteAction).not.toContain(".from('cedentes')")
    expect(cadastrarCedenteAction).not.toContain(".from('representantes')")
  })
})
