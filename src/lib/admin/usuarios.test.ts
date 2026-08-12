import { describe, expect, it } from 'vitest'
import { adminUsuarioConviteSchema, conviteInputFromFormData, parseAdminUsuarioFilters } from './usuarios'

describe('dominio administrativo de usuarios SA2', () => {
  it('normaliza filtros e limita a paginacao server-side aos tamanhos permitidos', () => {
    expect(parseAdminUsuarioFilters({ pagina: '-2', porPagina: '500', papel: 'invalido' })).toEqual({
      busca: '', papel: 'todos', status: 'todos', superAdmin: 'todos', pagina: 1, porPagina: 20,
    })
    expect(parseAdminUsuarioFilters({ busca: '  Admin ', papel: 'gestor', status: 'ativos', superAdmin: 'sim', pagina: '3', porPagina: '50' })).toEqual({
      busca: 'Admin', papel: 'gestor', status: 'ativos', superAdmin: 'sim', pagina: 3, porPagina: 50,
    })
  })

  it('aceita Gestor sem fundo e normaliza o e-mail', () => {
    const parsed = adminUsuarioConviteSchema.parse({ nome: 'Gestor Teste', email: ' GESTOR@EXAMPLE.COM ', tipo: 'gestor', fundoIds: [] })
    expect(parsed.email).toBe('gestor@example.com')
    expect(parsed.fundoIds).toEqual([])
  })

  it('bloqueia fundos para Super Admin puro e perfis fora do catalogo SA2', () => {
    expect(adminUsuarioConviteSchema.safeParse({ nome: 'Admin Teste', email: 'admin@example.com', tipo: 'super_admin', fundoIds: [crypto.randomUUID()] }).success).toBe(false)
    expect(adminUsuarioConviteSchema.safeParse({ nome: 'Cedente Teste', email: 'cedente@example.com', tipo: 'cedente', fundoIds: [] }).success).toBe(false)
  })

  it('le o payload do formulario sem aceitar campos de senha', () => {
    const form = new FormData()
    form.set('nome', 'Gestor Teste')
    form.set('email', 'gestor@example.com')
    form.set('tipo', 'gestor')
    form.append('fundoIds', '4aeb203b-ca53-40fa-8701-e453720bb15b')
    form.set('password', 'nao-deve-ser-lido')
    expect(conviteInputFromFormData(form)).toEqual({
      nome: 'Gestor Teste',
      email: 'gestor@example.com',
      tipo: 'gestor',
      fundoIds: ['4aeb203b-ca53-40fa-8701-e453720bb15b'],
    })
  })
})
