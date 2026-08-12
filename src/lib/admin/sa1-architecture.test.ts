import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260812143000_sa1_admin_fundos.sql', 'utf8')
const actions = readFileSync('src/app/admin/fundos/actions.ts', 'utf8')
const gestorActions = readFileSync('src/lib/actions/gestor.ts', 'utf8')
const gestorPage = readFileSync('src/app/gestor/fundos/page.tsx', 'utf8')
const communications = readFileSync('src/lib/comunicacoes/motor.server.ts', 'utf8')
const menu = readFileSync('src/components/auth/sidebar.tsx', 'utf8')
const adminListPage = readFileSync('src/app/admin/fundos/page.tsx', 'utf8')
const adminDetailPage = readFileSync('src/app/admin/fundos/[id]/page.tsx', 'utf8')

describe('arquitetura SA1 de fundos', () => {
  it('usa RPCs fechadas com validacao do papel real de Super Admin', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION private.usuario_e_super_admin()')
    expect(migration).toContain("up.papel::text = 'super_admin'")
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.admin_criar_fundo')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.admin_atualizar_fundo')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.admin_ativar_fundo')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.admin_desativar_fundo')
    expect(migration).not.toContain('GRANT EXECUTE ON FUNCTION public.admin_criar_fundo(text, text, text, text, text, text, text, text, text, text, text, text) TO service_role')
  })

  it('cria fundo inativo sem vinculo ou permissao operacional automatica', () => {
    expect(migration).toMatch(/INSERT INTO public\.fundos[\s\S]*false, \(SELECT auth\.uid\(\)\), now\(\), now\(\)/)
    expect(migration).not.toContain('INSERT INTO public.usuario_fundos')
    expect(migration).not.toContain('INSERT INTO public.cedente_fundos')
    expect(migration).not.toContain('admin_excluir_fundo')
  })

  it('nao condiciona a ativacao a configuracoes operacionais', () => {
    const activation = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_ativar_fundo'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_desativar_fundo'),
    )
    expect(activation).not.toContain('politicas_operacionais')
    expect(activation).not.toContain('templates_documentos')
    expect(activation).not.toContain('configuracoes_cnab')
    expect(activation).not.toContain('integracoes_fundo')
  })

  it('remove mutacao estrutural do gestor e preserva somente acesso operacional', () => {
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.fundos FROM authenticated')
    expect(gestorActions).not.toContain('export async function criarFundo(')
    expect(gestorActions).not.toContain('export async function atualizarFundo(')
    expect(gestorActions).not.toContain('export async function toggleAtivoFundo(')
    expect(gestorPage).not.toContain('Novo fundo')
    expect(gestorPage).not.toContain('Desativar')
    expect(gestorPage).toContain("redirect('/gestor/configuracoes')")
  })

  it('exige MFA fresco, usa concorrencia otimista e audita todas as mutacoes', () => {
    expect(actions).toContain("autorizarEConsumirAcaoSensivel(context, 'criar_fundo'")
    expect(actions).toContain("autorizarEConsumirAcaoSensivel(context, 'atualizar_fundo_estrutural'")
    expect(actions).toContain("input.ativar ? 'ativar_fundo' : 'desativar_fundo'")
    expect(actions).not.toContain('createAdminClient')
    expect(migration).toContain('p_updated_at_esperado')
    expect(migration).toContain("'FUNDO_CRIADO'")
    expect(migration).toContain("'FUNDO_ATUALIZADO'")
    expect(migration).toContain("'FUNDO_ATIVADO'")
    expect(migration).toContain("'FUNDO_DESATIVADO'")
    expect(migration).toContain("'FUNDO_REATIVADO'")
  })

  it('exclui fundos inativos do motor automatico de comunicacoes', () => {
    expect(communications).toContain(".in('id', fundoIds).eq('ativo', true)")
    expect(communications).toContain('if (!fund) return []')
  })

  it('preserva visao geral e fundos ao adicionar o modulo SA2 de usuarios', () => {
    const adminMenu = menu.slice(menu.indexOf('export const adminMenuItems'))
    expect(adminMenu).toContain("href: '/admin'")
    expect(adminMenu).toContain("href: '/admin/fundos'")
    expect(adminMenu).toContain("href: '/admin/usuarios'")
  })

  it('mantem listagem paginada e centraliza configuracao tecnica no Super Admin', () => {
    expect(adminListPage).toContain('porPagina')
    expect(adminListPage).toContain('<option value="20">')
    expect(adminListPage).toContain('<option value="50">')
    expect(adminListPage).toContain('<option value="100">')
    expect(adminDetailPage).toContain('>Geral</Link>')
    expect(adminDetailPage).toContain('>Gestores</Link>')
    expect(adminDetailPage).toContain('>Integracoes</Link>')
    expect(adminDetailPage).toContain('>CNAB</Link>')
    expect(adminDetailPage).toContain('>Auditoria</Link>')
    expect(adminDetailPage).not.toContain('Excluir fundo')
    expect(adminDetailPage).not.toContain('Templates juridicos')
  })
})
