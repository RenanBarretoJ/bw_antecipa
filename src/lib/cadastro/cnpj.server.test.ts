import { describe, expect, it, vi } from 'vitest'
import { consultarCnpj, validarCnpjServer } from './cnpj.server'

const CNPJ_VALIDO = '11222333000181'

function fakeFetch(response: Partial<Response> & { jsonBody?: unknown }): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.jsonBody,
  }) as unknown as typeof fetch
}

describe('validarCnpjServer', () => {
  it('valida CNPJ com digitos verificadores corretos', () => {
    expect(validarCnpjServer(CNPJ_VALIDO)).toBe(true)
  })

  it('rejeita CNPJ com digito verificador incorreto', () => {
    expect(validarCnpjServer('11222333000199')).toBe(false)
  })

  it('rejeita CNPJ com todos os digitos iguais', () => {
    expect(validarCnpjServer('11111111111111')).toBe(false)
  })

  it('rejeita CNPJ com tamanho invalido', () => {
    expect(validarCnpjServer('123')).toBe(false)
  })
})

describe('consultarCnpj (Matriz e Filial usam o mesmo service)', () => {
  it('nao chama a BrasilAPI quando o CNPJ e invalido -- validacao server-side antes do fetch', async () => {
    const fetchFn = fakeFetch({})
    const resultado = await consultarCnpj('00000000000000', fetchFn)
    expect(resultado).toEqual({ ok: false, categoria: 'cnpj_invalido', mensagem: 'CNPJ invalido.' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('preenche razao social, endereco e contato quando o CNPJ e valido', async () => {
    const fetchFn = fakeFetch({
      jsonBody: {
        razao_social: 'ACME LTDA',
        nome_fantasia: 'Acme',
        cnae_fiscal_descricao: 'Comercio varejista',
        descricao_situacao_cadastral: 'ATIVA',
        cep: '01310-100',
        logradouro: 'Av. Paulista',
        numero: '1000',
        complemento: 'Sala 1',
        bairro: 'Bela Vista',
        municipio: 'Sao Paulo',
        uf: 'SP',
        ddd_telefone_1: '1140028922',
        email: 'contato@acme.com',
      },
    })
    const resultado = await consultarCnpj(CNPJ_VALIDO, fetchFn)
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) throw new Error('esperado sucesso')
    expect(resultado.dados.razao_social).toBe('ACME LTDA')
    expect(resultado.dados.cep).toBe('01310100')
    expect(resultado.dados.uf).toBe('SP')
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining(CNPJ_VALIDO),
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('retorna categoria nao_encontrado quando a BrasilAPI responde 404', async () => {
    const fetchFn = fakeFetch({ ok: false, status: 404 })
    const resultado = await consultarCnpj(CNPJ_VALIDO, fetchFn)
    expect(resultado).toEqual({ ok: false, categoria: 'nao_encontrado', mensagem: 'CNPJ nao encontrado na Receita Federal.' })
  })

  it('nao falha silenciosamente quando a BrasilAPI esta indisponivel', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const resultado = await consultarCnpj(CNPJ_VALIDO, fetchFn)
    expect(resultado.ok).toBe(false)
    if (resultado.ok) throw new Error('esperado falha')
    expect(resultado.categoria).toBe('indisponivel')
    expect(resultado.mensagem).toMatch(/preencha.*manualmente/i)
  })

  it('reporta timeout distintamente de indisponibilidade generica', async () => {
    const erroTimeout = new Error('timeout')
    erroTimeout.name = 'TimeoutError'
    const fetchFn = vi.fn().mockRejectedValue(erroTimeout) as unknown as typeof fetch
    const resultado = await consultarCnpj(CNPJ_VALIDO, fetchFn)
    expect(resultado.ok).toBe(false)
    if (resultado.ok) throw new Error('esperado falha')
    expect(resultado.categoria).toBe('timeout')
  })
})
