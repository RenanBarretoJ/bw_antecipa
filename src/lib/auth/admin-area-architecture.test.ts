import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const middleware = source('src/lib/supabase/middleware.ts')
const layout = source('src/app/admin/layout.tsx')
const page = source('src/app/admin/page.tsx')
const fundLoaders = source('src/lib/admin/fundos.server.ts')
const shell = source('src/components/admin/admin-shell.tsx')
const sidebar = source('src/components/auth/sidebar.tsx')

describe('area administrativa SA0, SA1 e SA2', () => {
  it('envia anonimo para login e reconhece /admin no proxy', () => {
    expect(middleware).toContain("if (!user && !isPublicRoute)")
    expect(middleware).toContain("url.pathname = '/login'")
    expect(middleware).toContain("'admin'")
  })

  it('mantem guard server-side como barreira final', () => {
    expect(layout).toContain('await requireSuperAdmin()')
    expect(page).toContain('carregarResumoAdminFundos()')
    expect(page).toContain('carregarResumoAdminUsuarios()')
    expect(fundLoaders).toContain('await requireSuperAdmin()')
  })

  it('nao resolve fundo nem usuario_fundos na arvore administrativa', () => {
    const adminSources = [layout, page, shell].join('\n')
    expect(adminSources).not.toContain('resolverContextoFundoGestor')
    expect(adminSources).not.toContain('usuarioPossuiFundoAtivo')
    expect(adminSources).not.toContain('usuario_fundos')
    expect(adminSources).not.toContain('FundoAtivoProvider')
  })

  it('renderiza as entradas administrativas e a integracao logistica exclusiva do Super Admin', () => {
    const adminMenu = sidebar.slice(sidebar.indexOf('export const adminMenuItems'))
    const nonAdminMenus = sidebar.slice(0, sidebar.indexOf('export const adminMenuItems'))
    expect(adminMenu).toContain("href: '/admin'")
    expect(adminMenu).toContain("href: '/admin/fundos'")
    expect(adminMenu).toContain("href: '/admin/usuarios'")
    expect(adminMenu).toContain("href: '/admin/integracoes-transportadoras'")
    expect(adminMenu).toContain("href: '/admin/minha-seguranca'")
    expect(adminMenu).not.toMatch(/Auditoria global|Sistema/)
    expect((adminMenu.match(/href:/g) || [])).toHaveLength(5)
    expect(nonAdminMenus).not.toContain("href: '/admin/integracoes-transportadoras'")
  })

  it('mantem componentes de icone dentro da fronteira client', () => {
    expect(layout).not.toContain('adminMenuItems')
    expect(layout).not.toContain('menuItems=')
    expect(shell).toContain("import { adminMenuItems } from '@/components/auth/sidebar'")
    expect(shell).toContain('items={adminMenuItems}')
  })

  it('nao usa service role na UI administrativa', () => {
    expect([layout, page, shell].join('\n')).not.toMatch(/service[_-]?role/i)
  })
})
