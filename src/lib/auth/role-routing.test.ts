import { describe, expect, it } from 'vitest'
import { requireRoleRedirect } from './role-routing'

describe('redirecionamento por role', () => {
  it('mantém o dashboard correspondente ao perfil', () => {
    expect(requireRoleRedirect('gestor')).toBe('/gestor/dashboard')
    expect(requireRoleRedirect('cedente')).toBe('/cedente/dashboard')
    expect(requireRoleRedirect('sacado')).toBe('/sacado/dashboard')
    expect(requireRoleRedirect('consultor')).toBe('/consultor/dashboard')
    expect(requireRoleRedirect('super_admin')).toBe('/admin')
  })

  it('usa cedente como fallback quando o perfil não está disponível', () => {
    expect(requireRoleRedirect(null)).toBe('/cedente/dashboard')
  })

  it('encaminha o cedente sem cadastro empresarial para o onboarding', () => {
    expect(requireRoleRedirect('cedente', { cedenteAprovado: false })).toBe('/cedente/cadastro')
    expect(requireRoleRedirect('cedente', { cedenteAprovado: true })).toBe('/cedente/dashboard')
  })
})
