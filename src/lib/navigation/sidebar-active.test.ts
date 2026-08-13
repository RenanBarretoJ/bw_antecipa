import { describe, expect, it } from 'vitest'
import { isSidebarItemActive } from './sidebar-active'

const adminItems = ['/admin', '/admin/fundos', '/admin/usuarios']

function activeAdminItems(pathname: string) {
  return adminItems.filter((href) => isSidebarItemActive(pathname, href, 'super_admin'))
}

describe('estado ativo da sidebar administrativa', () => {
  it.each([
    ['/admin', '/admin'],
    ['/admin/fundos', '/admin/fundos'],
    ['/admin/fundos/novo', '/admin/fundos'],
    ['/admin/fundos/fundo-123', '/admin/fundos'],
    ['/admin/fundos/fundo-123?tab=auditoria', '/admin/fundos'],
    ['/admin/usuarios', '/admin/usuarios'],
    ['/admin/usuarios/novo', '/admin/usuarios'],
    ['/admin/usuarios/usuario-123', '/admin/usuarios'],
    ['/admin/usuarios/usuario-123?tab=seguranca', '/admin/usuarios'],
  ])('ativa somente o item esperado em %s', (pathname, expectedHref) => {
    expect(activeAdminItems(pathname)).toEqual([expectedHref])
  })

  it('nao ativa a visao geral por prefixo em subrotas administrativas', () => {
    expect(isSidebarItemActive('/admin/usuarios', '/admin', 'super_admin')).toBe(false)
    expect(isSidebarItemActive('/admin/fundos', '/admin', 'super_admin')).toBe(false)
  })
})
