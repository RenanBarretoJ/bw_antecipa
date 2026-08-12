import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resolverDestinoAposAutenticacao, usuarioPodeAcessarArea, usuarioPossuiFundoAtivo, type PlataformaAccessSnapshot } from './platform-access'

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

  it('considera operacional somente vinculo ativo com fundo estruturalmente ativo', async () => {
    const filtros: Array<[string, unknown]> = []
    const query = {
      select: () => query,
      eq: (campo: string, valor: unknown) => { filtros.push([campo, valor]); return query },
      limit: () => query,
      maybeSingle: async () => ({ data: { id: 'vinculo-1' }, error: null }),
    }
    const client = { from: () => query } as unknown as SupabaseClient<Database>

    await expect(usuarioPossuiFundoAtivo(client, 'usuario-1')).resolves.toBe(true)
    expect(filtros).toContainEqual(['usuario_id', 'usuario-1'])
    expect(filtros).toContainEqual(['status', 'ativo'])
    expect(filtros).toContainEqual(['fundos.ativo', true])
  })
})
