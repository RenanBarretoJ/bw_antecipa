import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260731140710_escopo9c_storage_autorizacao_multifundo.sql'),
  'utf8',
)
const action = readFileSync(
  resolve(process.cwd(), 'src/lib/actions/arquivo-nota-fiscal.ts'),
  'utf8',
)
const gestorPage = readFileSync(
  resolve(process.cwd(), 'src/app/gestor/notas-fiscais/[id]/page.tsx'),
  'utf8',
)
const cedentePage = readFileSync(
  resolve(process.cwd(), 'src/app/cedente/notas-fiscais/[id]/page.tsx'),
  'utf8',
)

describe('autorizacao de Storage do Escopo 9C', () => {
  it('mantem um unico SELECT autenticado baseado no helper privado', () => {
    expect(migration).toContain('CREATE POLICY storage_private_objects_select_authorized')
    expect(migration).toMatch(/FOR SELECT[\s\S]+TO authenticated[\s\S]+USING/)
    expect(migration).toContain('private.usuario_pode_ler_objeto_storage')
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+FOR SELECT[\s\S]+TO anon/)
  })

  it('protege o helper SECURITY DEFINER e nao recebe user_id do cliente', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION private\.usuario_pode_ler_objeto_storage\([\s\S]*p_bucket text,[\s\S]*p_path text[\s\S]*\)/)
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain('SET search_path = pg_catalog, public, private')
    expect(migration).toContain('auth.uid()')
    expect(migration).toContain("regexp_replace(coalesce(nf.cnpj_destinatario, ''), '\\D', '', 'g')")
    expect(migration).toContain('REVOKE ALL ON FUNCTION private.usuario_pode_ler_objeto_storage(text, text) FROM PUBLIC')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION private.usuario_pode_ler_objeto_storage(text, text) TO authenticated')
    expect(migration).not.toMatch(/p_user_id/i)
  })

  it('valida o ator e resolve o path registrado antes de usar service role', () => {
    const authorizationAt = action.indexOf('requireNotaFiscalAccess(notaFiscalId)')
    const pathAt = action.indexOf(".select('id, arquivo_url')")
    const adminAt = action.indexOf('createAdminClient().storage')

    expect(authorizationAt).toBeGreaterThan(-1)
    expect(pathAt).toBeGreaterThan(authorizationAt)
    expect(adminAt).toBeGreaterThan(pathAt)
    expect(action).toContain('nota.arquivo_url')
    expect(action).not.toMatch(/export async function obterUrlArquivoNotaFiscal\([^)]*path/i)
  })

  it('nao gera URL assinada diretamente nas paginas de NF', () => {
    expect(gestorPage).toContain('obterUrlArquivoNotaFiscal(nfData.id)')
    expect(cedentePage).toContain('obterUrlArquivoNotaFiscal(nfData.id)')
    expect(gestorPage).not.toContain('createSignedUrl(')
    expect(cedentePage).not.toContain('createSignedUrl(')
  })
})
