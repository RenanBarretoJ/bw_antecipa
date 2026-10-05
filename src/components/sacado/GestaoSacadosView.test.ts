import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { GestaoSacadosView } from './GestaoSacadosView'
import { GestaoAcessoForm } from './GestaoAcessoForm'
import type { carregarGestaoSacados } from '@/lib/sacado/gestao.server'

vi.mock('@/lib/actions/sacado-acessos', () => ({ gerenciarAcessoSacado: vi.fn(), consultarEmpresaSacado: vi.fn() }))
const result: Awaited<ReturnType<typeof carregarGestaoSacados>> = {
  fundo: { id: 'fundo-qa', nome: 'Fundo QA' }, fundos: [{ id: 'fundo-qa', nome: 'Fundo QA' }],
  busca: '', pagina: 1, userId: null, pode_editar: true, total: 1,
  usuarios: [{ id: 'user-qa', nome_completo: 'Usuário QA', email: 'qa@example.invalid', status: 'ativo', cnpjs_ativos: 1 }],
  acessos: [{ id: 'vinculo-qa', user_id: 'user-qa', cnpj: '11344038002141', razao_social: 'Empresa sintética QA', status: 'ativo', created_at: '2026-10-05T12:00:00Z', updated_at: '2026-10-05T12:00:00Z' }],
}
const render = (overrides: Partial<typeof result> = {}) => renderToStaticMarkup(createElement(GestaoSacadosView, { result: { ...result, ...overrides }, basePath: '/gestor/sacados' }))

describe('Gestão de sacados: apresentação e navegação', () => {
  it('exibe listagem com status e links no novo endereço', () => {
    const html = render()
    expect(html).toContain('Usuários sacados')
    expect(html).toContain('qa@example.invalid')
    expect(html).toContain('href="/gestor/sacados?fundo=fundo-qa')
    expect(html).toContain('usuario=user-qa')
    expect(html).not.toContain('/configuracoes/sacados')
  })
  it('detalha CNPJs sem repetir o nome do fundo em cada cartão', () => {
    const html = render({ userId: 'user-qa' })
    expect(html).toContain('Empresas vinculadas')
    expect(html).toContain('11.344.038/0021-41')
    expect(html).toContain('1 de 1 CNPJs ativos')
    expect(html).toContain('Adicionar empresa / CNPJ')
    expect(html).toContain('Confirmação de segurança')
  })
  it('não oferece formulários a quem só pode consultar', () => {
    const html = render({ userId: 'user-qa', pode_editar: false })
    expect(html).toContain('Empresas vinculadas')
    expect(html).not.toContain('Gerenciar acesso')
    expect(html).not.toContain('name="mfa"')
  })
  it('diferencia lista vazia de usuário sem empresas e preserva filtro ao limpar', () => {
    expect(render({ usuarios: [], total: 0, busca: 'qa' })).toContain('Nenhum sacado encontrado')
    expect(render({ usuarios: [], total: 0, busca: 'qa' })).toContain('href="/gestor/sacados?fundo=fundo-qa"')
    expect(render({ userId: 'user-qa', acessos: [] })).toContain('Nenhuma empresa vinculada')
  })
  it('preserva fundo, busca e página na navegação', () => {
    const html = render({ pagina: 2, total: 45, busca: 'teste nome' })
    expect(html).toContain('Página 2 de 3')
    expect(html).toContain('busca=teste+nome&amp;pagina=1')
    expect(html).toContain('busca=teste+nome&amp;pagina=3')
    expect(html).toContain('busca=teste+nome&amp;pagina=2&amp;usuario=user-qa')
  })
  it('mantém confirmação obrigatória, MFA e os identificadores de escopo', () => {
    const html = renderToStaticMarkup(createElement(GestaoAcessoForm, { usuario: 'user-qa', fundo: 'fundo-qa' }))
    expect(html).toContain('name="usuario" value="user-qa"')
    expect(html).toContain('name="fundo" value="fundo-qa"')
    expect(html).toMatch(/<input(?=[^>]*name="confirmacao")(?=[^>]*required)[^>]*>/)
    expect(html).toContain('pattern="[0-9]{6}"')
    expect(html).toContain('name="mfa"')
  })
  it('posiciona Sacados depois do Dashboard e remove o atalho de Configurações', () => {
    const menu = readFileSync('src/components/auth/sidebar.tsx', 'utf8')
    expect(menu).toMatch(/href: '\/gestor\/dashboard'[^\n]*\n\s*\{ label: 'Sacados', href: '\/gestor\/sacados'/)
    expect(readFileSync('src/app/gestor/configuracoes/page.tsx', 'utf8')).not.toContain('/configuracoes/sacados')
  })
})
