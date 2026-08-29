import { describe, expect, it } from 'vitest'
import { canUseTodosOsFundos, escolherFundoInicial, type FundoAutorizado } from './fundo-ativo'

const fundoA: FundoAutorizado = {
  id: 'fundo-a',
  nome: 'Fundo A',
  cnpj: '00000000000100',
  status: 'ativo',
  perfilNoFundo: 'administrador',
  principal: false,
}

const fundoB: FundoAutorizado = {
  id: 'fundo-b',
  nome: 'Fundo B',
  cnpj: '00000000000200',
  status: 'ativo',
  perfilNoFundo: 'gestor',
  principal: true,
}

describe('fundo ativo', () => {
  it('seleciona automaticamente fundo unico', () => {
    expect(escolherFundoInicial({ fundos: [fundoA], cookieFundoId: null })?.id).toBe('fundo-a')
  })

  it('usa ultimo fundo valido selecionado', () => {
    expect(escolherFundoInicial({ fundos: [fundoA, fundoB], cookieFundoId: 'fundo-a' })?.id).toBe('fundo-a')
  })

  it('usa fundo principal quando cookie esta ausente ou invalido', () => {
    expect(escolherFundoInicial({ fundos: [fundoA, fundoB], cookieFundoId: 'invalido' })?.id).toBe('fundo-b')
  })

  it('retorna null para usuario sem fundos autorizados', () => {
    expect(escolherFundoInicial({ fundos: [], cookieFundoId: null })).toBeNull()
  })

  it('nao libera visao consolidada para gestor comum', () => {
    expect(canUseTodosOsFundos('gestor')).toBe(false)
    expect(canUseTodosOsFundos('administrador')).toBe(false)
  })

  it('libera visao consolidada somente para perfil plataforma', () => {
    expect(canUseTodosOsFundos('plataforma')).toBe(true)
  })
})
