import { describe, expect, it } from 'vitest'
import { adminFundoSchema, FUNDO_CAMPOS_ESTRUTURAIS, normalizarCnpj, parseAdminFundoFilters, validarCnpj } from './fundos'

const dadosValidos = {
  nome: 'Fundo Teste FIDC',
  cnpj: '11.222.333/0001-81',
  administradora_nome: 'Administradora Teste',
  administradora_cnpj: '00.360.305/0001-04',
  gestora_nome: 'Gestora Teste',
  gestora_cnpj: '13.703.306/0001-56',
  custodiante_nome: '',
  custodiante_cnpj: '',
  administradora_endereco: '',
  administradora_ato_declaratorio: '',
  contato_nome: '',
  contato_email: '',
}

describe('dominio administrativo de fundos', () => {
  it('normaliza e valida CNPJ com digitos verificadores', () => {
    expect(normalizarCnpj('11.222.333/0001-81')).toBe('11222333000181')
    expect(validarCnpj('11.222.333/0001-81')).toBe(true)
    expect(validarCnpj('11.222.333/0001-82')).toBe(false)
    expect(validarCnpj('11.111.111/1111-11')).toBe(false)
  })

  it('valida os dados estruturais e nao inclui configuracoes operacionais', () => {
    expect(adminFundoSchema.safeParse(dadosValidos).success).toBe(true)
    expect(FUNDO_CAMPOS_ESTRUTURAIS).not.toContain('banco')
    expect(FUNDO_CAMPOS_ESTRUTURAIS).not.toContain('agencia')
    expect(FUNDO_CAMPOS_ESTRUTURAIS).not.toContain('conta_vinculada')
    expect(FUNDO_CAMPOS_ESTRUTURAIS).not.toContain('codigo_originador')
  })

  it('normaliza filtros, pagina e tamanhos permitidos', () => {
    expect(parseAdminFundoFilters({ status: 'invalido', pagina: '-1', porPagina: '999' })).toEqual({ busca: '', status: 'todos', pagina: 1, porPagina: 20 })
    expect(parseAdminFundoFilters({ busca: '  teste ', status: 'ativos', pagina: '3', porPagina: '50' })).toEqual({ busca: 'teste', status: 'ativos', pagina: 3, porPagina: 50 })
  })
})
