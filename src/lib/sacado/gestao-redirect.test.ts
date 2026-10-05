import { describe, expect, it, vi } from 'vitest'
import Page from '@/app/gestor/configuracoes/sacados/page'

const redirect = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ redirect }))
describe('Compatibilidade do endereço antigo de sacados', () => {
  it('redireciona preservando usuário, fundo, busca e página', async () => {
    await Page({ searchParams: Promise.resolve({ fundo: 'qa', usuario: 'user', busca: 'nome & sobrenome', pagina: '2' }) })
    expect(redirect).toHaveBeenLastCalledWith('/gestor/sacados?fundo=qa&usuario=user&busca=nome+%26+sobrenome&pagina=2')
  })
  it('redireciona sem query vazia', async () => {
    await Page({ searchParams: Promise.resolve({}) })
    expect(redirect).toHaveBeenLastCalledWith('/gestor/sacados')
  })
})
