import { describe, expect, it, vi } from 'vitest'
import { gestorMenuItems } from './sidebar'

vi.mock('@/components/layout/portal-sidebar', () => ({ PortalSidebar: () => null }))

describe('Central de Bases no menu existente', () => {
  it('atualiza somente o nome visível e preserva a rota e a posição', () => {
    const index = gestorMenuItems.findIndex(item => item.href === '/gestor/dados-financeiros')
    expect(index).toBeGreaterThan(0)
    expect(gestorMenuItems[index].label).toBe('Central de Bases')
    expect(gestorMenuItems[index - 1].href).toBe('/gestor/conciliacao')
    expect(gestorMenuItems[index + 1].href).toBe('/gestor/escrow')
    expect(gestorMenuItems.filter(item => item.href === '/gestor/dados-financeiros')).toHaveLength(1)
    expect(gestorMenuItems.some(item => item.label === 'Dados Financeiros')).toBe(false)
  })
})
