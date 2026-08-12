import { describe, expect, it } from 'vitest'
import { resolverDestinoAposAutenticacao, usuarioPodeAcessarArea, type PlataformaAccessSnapshot } from './platform-access'

describe('destino pos-autenticacao multi-role', () => {
  it('prioriza a area independente do Super Admin', () => {
    expect(resolverDestinoAposAutenticacao({
      primaryRole: 'super_admin',
      roles: ['super_admin'],
      gestorPossuiFundoAtivo: false,
    })).toBe('/admin')
  })

  it('leva usuario hibrido admin + gestor para a area administrativa', () => {
    expect(resolverDestinoAposAutenticacao({
      primaryRole: 'gestor',
      roles: ['gestor', 'super_admin'],
      gestorPossuiFundoAtivo: true,
    })).toBe('/admin')
  })

  it('leva gestor sem fundo para estado vazio sem criar loop', () => {
    expect(resolverDestinoAposAutenticacao({
      primaryRole: 'gestor',
      roles: ['gestor'],
      gestorPossuiFundoAtivo: false,
    })).toBe('/gestor/sem-fundo')
  })

  it('preserva onboarding do cedente ainda nao aprovado', () => {
    expect(resolverDestinoAposAutenticacao({
      primaryRole: 'cedente',
      roles: ['cedente'],
      gestorPossuiFundoAtivo: false,
      cedenteAprovado: false,
    })).toBe('/cedente/cadastro')
  })

  it.each(['gestor', 'cedente', 'consultor', 'sacado'] as const)('nao libera /admin para %s sem papel complementar', (role) => {
    expect(usuarioPodeAcessarArea({
      primaryRole: role,
      roles: [role],
      gestorPossuiFundoAtivo: role === 'gestor',
    }, 'admin')).toBe(false)
  })

  it('nao transforma Super Admin puro em gestor global', () => {
    expect(usuarioPodeAcessarArea({
      primaryRole: 'super_admin',
      roles: ['super_admin'],
      gestorPossuiFundoAtivo: false,
    }, 'gestor')).toBe(false)
  })

  it('libera as duas areas somente ao hibrido cujo papel primario operacional e gestor', () => {
    const access: PlataformaAccessSnapshot = {
      primaryRole: 'gestor',
      roles: ['gestor', 'super_admin'],
      gestorPossuiFundoAtivo: true,
    }
    expect(usuarioPodeAcessarArea(access, 'admin')).toBe(true)
    expect(usuarioPodeAcessarArea(access, 'gestor')).toBe(true)
  })
})
