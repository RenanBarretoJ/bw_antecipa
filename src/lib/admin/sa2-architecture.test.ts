import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260812170000_sa2_admin_usuarios_acessos.sql', 'utf8')
const actions = readFileSync('src/app/admin/usuarios/actions.ts', 'utf8')
const adapter = readFileSync('src/lib/admin/auth-admin.server.ts', 'utf8')
const menu = readFileSync('src/components/auth/sidebar.tsx', 'utf8')
const listPage = readFileSync('src/app/admin/usuarios/page.tsx', 'utf8')
const detailPage = readFileSync('src/app/admin/usuarios/[id]/page.tsx', 'utf8')
const fundDetailPage = readFileSync('src/app/admin/fundos/[id]/page.tsx', 'utf8')
const platformAccess = readFileSync('src/lib/auth/platform-access.ts', 'utf8')
const mfaActions = readFileSync('src/app/actions/mfa.ts', 'utf8')

describe('arquitetura SA2 de usuarios e acessos', () => {
  it('preserva as entradas SA2 no menu administrativo ampliado pelo SA4', () => {
    const adminMenu = menu.slice(menu.indexOf('export const adminMenuItems'))
    expect(adminMenu).toContain("href: '/admin'")
    expect(adminMenu).toContain("href: '/admin/fundos'")
    expect(adminMenu).toContain("href: '/admin/usuarios'")
  })

  it('lista pelo catalogo profiles com busca, filtros e paginacao server-side', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.admin_listar_usuarios')
    expect(migration).toContain('FROM public.profiles p')
    expect(migration).toContain('p_por_pagina NOT IN (20, 50, 100)')
    expect(listPage).toContain('method="get"')
    expect(listPage).toContain('<option value="20">')
    expect(listPage).toContain('<option value="50">')
    expect(listPage).toContain('<option value="100">')
    expect(listPage).not.toContain('createAdminClient')
  })

  it('isola service role no adaptador Auth e nao o usa para papeis ou vinculos', () => {
    expect(adapter).toContain("import 'server-only'")
    expect(adapter).toContain('generateLink')
    expect(adapter).toContain('enviarEmailOperacional')
    expect(adapter).not.toContain('inviteUserByEmail')
    expect(adapter).toContain('updateUserById')
    expect(adapter).toContain('mfa.deleteFactor')
    expect(actions).not.toContain('createAdminClient')
    expect(adapter).not.toContain("from('usuario_fundos')")
    expect(adapter).not.toContain("from('usuario_papeis')")
  })

  it('exige autorizacao sensivel com TOTP fresco para todas as mutacoes SA2', () => {
    for (const action of [
      'convidar_usuario_admin', 'vincular_gestor_fundo', 'revogar_gestor_fundo',
      'reativar_gestor_fundo', 'desativar_usuario', 'reativar_usuario',
      'conceder_super_admin', 'revogar_super_admin', 'reset_mfa_administrativo',
    ]) expect(actions).toContain(`'${action}'`)
  })

  it('preserva o modelo multi-role e bloqueia conversao implicita', () => {
    expect(migration).toContain("v_perfil.role::text <> 'gestor'")
    expect(migration).toContain("'papel_primario', v_perfil.role")
    expect(migration).toContain('Super Admin puro deve ser desativado; conversao automatica de papel nao e permitida')
    expect(migration).toContain("UPDATE public.profiles SET role = 'super_admin'::public.user_role")
    expect(migration).toContain('Super Admin puro nao recebe fundos operacionais')
  })

  it('protege o ultimo Super Admin dentro da transacao e bloqueia self-demotion', () => {
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock(82002612, 2)')
    expect(migration).toContain('PERFORM private.proteger_ultimo_super_admin(p_usuario_id)')
    expect(migration).toContain('A autorrevogacao administrativa esta bloqueada neste fluxo')
    expect(migration).toContain('A autodesativacao administrativa esta bloqueada neste fluxo')
  })

  it('mantem um vinculo canonico, sem DELETE e com operacoes idempotentes', () => {
    expect(migration).toContain('pg_catalog.hashtextextended')
    expect(migration).toContain("IF v_vinculo.status = 'ativo' THEN")
    expect(migration).toContain("IF v_vinculo.status = 'revogado' THEN")
    expect(migration).toContain("UPDATE public.usuario_fundos SET status = 'revogado'")
    expect(migration).not.toContain('DELETE FROM public.usuario_fundos')
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.usuario_fundos FROM authenticated')
  })

  it('exige usuario, vinculo e fundo ativos no contexto operacional', () => {
    expect(platformAccess).toContain(".eq('status', 'ativo')")
    expect(platformAccess).toContain(".eq('fundos.ativo', true)")
    expect(platformAccess).toContain(".select('id, fundos!inner(id)')")
  })

  it('registra todos os eventos administrativos obrigatorios sem segredos', () => {
    for (const event of [
      'USUARIO_GESTOR_CONVIDADO', 'USUARIO_DESATIVADO', 'USUARIO_REATIVADO',
      'GESTOR_VINCULADO_FUNDO', 'GESTOR_VINCULO_REVOGADO', 'GESTOR_VINCULO_REATIVADO',
      'SUPER_ADMIN_CONCEDIDO', 'SUPER_ADMIN_REVOGADO', 'MFA_RESETADO_ADMIN',
    ]) expect(migration).toContain(`'${event}'`)
    expect(migration).toContain('p_correlation_id uuid')
    expect(migration).toContain('COALESCE(p_correlation_id, gen_random_uuid())')
    expect(actions).toContain('const correlationId = randomUUID()')
    expect(actions).toContain('p_correlation_id: correlationId')
    expect(migration).not.toMatch(/jsonb_build_object\([^)]*(password|senha|token|secret)/i)
  })

  it('entrega as abas de usuario e a visao Fundo para Gestores', () => {
    for (const tab of ['geral', 'fundos', 'seguranca', 'auditoria']) expect(detailPage).toContain(`'${tab}'`)
    expect(fundDetailPage).toContain("?tab=gestores")
    expect(fundDetailPage).toContain('GestorFundAccessAction')
  })

  it('restringe o reset administrativo de MFA ao Super Admin e reutiliza o adaptador compartilhado', () => {
    expect(mfaActions).toContain('requireSuperAdmin()')
    expect(mfaActions).toContain('removerFatoresMfaAuth')
    expect(mfaActions).toContain("rpc('admin_concluir_reset_mfa'")
    expect(actions).toContain('O reset administrativo do proprio MFA esta bloqueado')
  })

  it('nao amplia RLS dos dominios operacionais', () => {
    for (const table of ['operacoes', 'notas_fiscais', 'documentos', 'cedentes', 'sacados']) {
      expect(migration).not.toContain(`ON public.${table}`)
    }
  })
})
