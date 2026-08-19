import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260819140000_p0_mutacoes_cadastro_cedente_gestor.sql', 'utf8')
const migrationLeituraLeak = readFileSync('supabase/migrations/20260819141000_p0_cedentes_leitura_multifundo_gestor.sql', 'utf8')
const actions = readFileSync('src/lib/actions/gestor.ts', 'utf8')

const RPCS = [
  ['aprovar_cadastro_cedente_gestor', 'uuid'],
  ['reprovar_cadastro_cedente_gestor', 'uuid'],
  ['alternar_escrow_cedente_gestor', 'uuid, boolean'],
  ['alternar_coobrigacao_cedente_gestor', 'uuid, boolean'],
  ['aprovar_alteracao_cadastral_cedente_gestor', 'uuid'],
  ['reprovar_alteracao_cadastral_cedente_gestor', 'uuid, text'],
] as const

function actionBody(startMarker: string, endMarker: string) {
  return actions.slice(actions.indexOf(startMarker), endMarker ? actions.indexOf(endMarker) : undefined)
}

describe('correcao P0: mutacoes do cadastro do Cedente sem escrita direta em cedentes', () => {
  it('as seis acoes chamam suas RPCs e nao fazem mais UPDATE direto em cedentes/representantes', () => {
    const aprovarCedente = actionBody('export async function aprovarCedente', 'export async function reprovarCedente')
    expect(aprovarCedente).toContain("supabase.rpc('aprovar_cadastro_cedente_gestor'")
    expect(aprovarCedente).not.toContain("from('cedentes')\n    .update(")
    expect(aprovarCedente).not.toContain("from('contas_escrow')\n    .insert(")

    const reprovarCedente = actionBody('export async function reprovarCedente', 'export async function toggleCoobrigacaoCedente')
    expect(reprovarCedente).toContain("supabase.rpc('reprovar_cadastro_cedente_gestor'")
    expect(reprovarCedente).not.toContain("from('cedentes')\n    .update(")

    const toggleCoobrigacao = actionBody('export async function toggleCoobrigacaoCedente', 'export async function toggleEscrowCedente')
    expect(toggleCoobrigacao).toContain("supabase.rpc('alternar_coobrigacao_cedente_gestor'")
    expect(toggleCoobrigacao).not.toContain("from('cedentes')\n    .update(")

    const toggleEscrow = actionBody('export async function toggleEscrowCedente', 'export async function aprovarAlteracaoCedente')
    expect(toggleEscrow).toContain("supabase.rpc('alternar_escrow_cedente_gestor'")
    expect(toggleEscrow).not.toContain("from('cedentes')\n    .update(")

    const aprovarAlteracao = actionBody('export async function aprovarAlteracaoCedente', 'export async function reprovarAlteracaoCedente')
    expect(aprovarAlteracao).toContain("supabase.rpc('aprovar_alteracao_cadastral_cedente_gestor'")
    expect(aprovarAlteracao).not.toContain("from('cedentes')\n    .update(")
    expect(aprovarAlteracao).not.toContain("from('representantes')\n    .delete(")
    expect(aprovarAlteracao).not.toContain("from('representantes')\n    .insert(")

    const reprovarAlteracao = actionBody('export async function reprovarAlteracaoCedente', 'export async function solicitarAtualizacaoDocumento')
    expect(reprovarAlteracao).toContain("supabase.rpc('reprovar_alteracao_cadastral_cedente_gestor'")
    expect(reprovarAlteracao).not.toContain("from('solicitacoes_alteracao_cedente')\n    .update(")
  })

  it('define as seis RPCs como SECURITY DEFINER com search_path fechado', () => {
    for (const [name] of RPCS) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${name}`)
    }
    expect(migration.match(/^SECURITY DEFINER$/gm)?.length).toBe(7) // 6 RPCs publicas + o helper private
    expect(migration.match(/^SET search_path = ''$/gm)?.length).toBe(7)
  })

  it('reutiliza a mesma regra multifundo dos documentos, via helper dedicado', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION private.gestor_tem_acesso_cedente')
    expect(migration).toContain('private.usuario_tem_acesso_fundo(cf.fundo_id)')
    expect(migration.match(/private\.gestor_tem_acesso_cedente\(/g)?.length).toBeGreaterThanOrEqual(7)
  })

  it('concede EXECUTE apenas para authenticated e revoga de PUBLIC/anon em todas as RPCs', () => {
    for (const [name, args] of RPCS) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC, anon`)
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO authenticated`)
    }
  })

  it('nao reabre GRANT de escrita direta em cedentes, representantes ou contas_escrow', () => {
    expect(migration).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE).*ON TABLE public\.(cedentes|representantes|contas_escrow) TO authenticated/i)
  })

  it('fecha o RLS_GAP de solicitacoes_alteracao_cedente: revoga UPDATE de authenticated e remove a policy sem checagem de fundo', () => {
    expect(migration).toContain('REVOKE UPDATE ON TABLE public.solicitacoes_alteracao_cedente FROM authenticated')
    expect(migration).toContain('DROP POLICY IF EXISTS sac_gestor_all ON public.solicitacoes_alteracao_cedente')
    expect(migration).toContain('private.gestor_tem_acesso_cedente(cedente_id)')
  })

  it('exige motivo na reprovacao de alteracao cadastral e bloqueia reanalise', () => {
    expect(migration).toContain('Motivo da reprovacao e obrigatorio')
    expect(migration).toContain("v_status_atual <> 'pendente'")
    expect(migration).toContain("v_status_atual = 'ativo'")
  })

  it('fecha o leak de leitura cross-fund descoberto no proprio E2E: cedentes_gestor_all substituida por policy multifundo', () => {
    expect(migrationLeituraLeak).toContain('DROP POLICY IF EXISTS cedentes_gestor_all ON public.cedentes')
    expect(migrationLeituraLeak).toContain('CREATE POLICY cedentes_gestor_multifundo_select')
    expect(migrationLeituraLeak).toContain('private.gestor_tem_acesso_cedente(id)')
  })
})
