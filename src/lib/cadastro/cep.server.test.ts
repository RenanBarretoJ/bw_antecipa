import { describe, expect, it, vi } from 'vitest'
import { consultarCep } from './cep.server'

function fakeFetch(response: Partial<Response> & { jsonBody?: unknown }): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.jsonBody,
  }) as unknown as typeof fetch
}

describe('consultarCep (Matriz e Filial usam o mesmo service)', () => {
  it('rejeita CEP com tamanho invalido sem chamar o ViaCEP', async () => {
    const fetchFn = fakeFetch({})
    const resultado = await consultarCep('123', fetchFn)
    expect(resultado).toEqual({ ok: false, categoria: 'cep_invalido', mensagem: 'CEP invalido.' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('preenche logradouro, bairro, cidade e UF quando o CEP e valido', async () => {
    const fetchFn = fakeFetch({
      jsonBody: { cep: '01310-100', logradouro: 'Av. Paulista', bairro: 'Bela Vista', localidade: 'Sao Paulo', uf: 'SP' },
    })
    const resultado = await consultarCep('01310100', fetchFn)
    expect(resultado).toEqual({
      ok: true,
      dados: { cep: '01310100', logradouro: 'Av. Paulista', bairro: 'Bela Vista', cidade: 'Sao Paulo', uf: 'SP' },
    })
  })

  it('retorna nao_encontrado quando o ViaCEP responde erro:true', async () => {
    const fetchFn = fakeFetch({ jsonBody: { erro: true } })
    const resultado = await consultarCep('00000000', fetchFn)
    expect(resultado).toEqual({ ok: false, categoria: 'nao_encontrado', mensagem: 'CEP nao encontrado.' })
  })

  it('nao falha silenciosamente quando o ViaCEP esta indisponivel', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const resultado = await consultarCep('01310100', fetchFn)
    expect(resultado.ok).toBe(false)
    if (resultado.ok) throw new Error('esperado falha')
    expect(resultado.categoria).toBe('indisponivel')
    expect(resultado.mensagem).toMatch(/preencha.*manualmente/i)
  })
})
