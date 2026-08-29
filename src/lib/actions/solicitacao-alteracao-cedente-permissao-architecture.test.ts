import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260826120000_p0_corrigir_permissao_solicitacao_alteracao_cedente.sql'),
  'utf8',
)
const cedenteActions = readFileSync(resolve(process.cwd(), 'src/lib/actions/cedente.ts'), 'utf8')

describe('P0: corrige "permission denied for table solicitacoes_alteracao_cedente"', () => {
  it('cria a RPC de escrita e nao reabre GRANT de INSERT/UPDATE direto para authenticated', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.solicitar_alteracao_cadastral_cedente(')
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).not.toMatch(/GRANT\s+(INSERT|UPDATE)\s+ON TABLE public\.solicitacoes_alteracao_cedente TO authenticated/i)
  })

  it('resolve o cedente pelo auth.uid() -- nunca aceita cedente_id do cliente', () => {
    const corpo = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.solicitar_alteracao_cadastral_cedente('))
    expect(corpo).not.toContain('p_cedente_id')
    expect(corpo).toContain('v_cedente_id := public.get_user_cedente_id();')
  })

  it('exige que o solicitante seja o dono do cedente ou tenha perfil administrador (mesma regra de ehAdministrador)', () => {
    const corpo = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.solicitar_alteracao_cadastral_cedente('))
    expect(corpo).toContain('v_owner_user_id IS DISTINCT FROM (SELECT auth.uid())')
    expect(corpo).toContain("public.get_user_cedente_acesso_perfil() IS DISTINCT FROM 'administrador'")
  })

  it('bloqueia nova solicitacao quando ja existe uma pendente', () => {
    const corpo = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.solicitar_alteracao_cadastral_cedente('))
    expect(corpo).toContain("s.status = 'pendente'")
    expect(corpo).toContain('Ja existe uma solicitacao de alteracao aguardando aprovacao.')
  })

  it('audita a solicitacao na mesma transacao do INSERT', () => {
    const corpo = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.solicitar_alteracao_cadastral_cedente('))
    const indiceInsertSolicitacao = corpo.indexOf('INSERT INTO public.solicitacoes_alteracao_cedente')
    const indiceInsertLog = corpo.indexOf('INSERT INTO public.logs_auditoria')
    expect(indiceInsertSolicitacao).toBeGreaterThan(-1)
    expect(indiceInsertLog).toBeGreaterThan(indiceInsertSolicitacao)
    expect(corpo).toContain("'ALTERACAO_CADASTRAL_SOLICITADA'")
  })

  it('restringe a execucao a authenticated, nunca anon', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.solicitar_alteracao_cadastral_cedente(jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.solicitar_alteracao_cadastral_cedente(jsonb, jsonb, jsonb, jsonb) TO authenticated')
  })

  it('solicitarAlteracaoCedente chama a RPC, nao mais o INSERT direto que ficava "permission denied"', () => {
    expect(cedenteActions).toContain("supabase.rpc('solicitar_alteracao_cadastral_cedente'")
    expect(cedenteActions).not.toContain("from('solicitacoes_alteracao_cedente')\n    .insert(")
  })
})
