import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createDestinatarioResolver } from './destinatario.server'

const CNPJ = '11222333000181'
const dadosCnpj = (razaoSocial: string) => ({
  cnpj: CNPJ,
  razao_social: razaoSocial,
  nome_fantasia: '',
  cnae_principal: '',
  situacao_cadastral: 'ATIVA',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  telefone: '',
  email: '',
})

describe('resolverRazaoSocialDestinatario', () => {
  it('preserva o nome extraido do documento sem consultar o CNPJ', async () => {
    const consultar = vi.fn()
    const resolver = createDestinatarioResolver({ consultar })

    await expect(resolver({ cnpj: CNPJ, razaoSocial: '  SACADO  QA\nLTDA  ' })).resolves.toEqual({
      razaoSocial: 'SACADO QA LTDA',
      source: 'document',
    })
    expect(consultar).not.toHaveBeenCalled()
  })

  it('consulta o CNPJ e preenche a razao social quando o documento nao trouxe nome', async () => {
    const consultar = vi.fn().mockResolvedValue({
      ok: true,
      dados: dadosCnpj('SACADO CONSULTADO LTDA'),
    })
    const resolver = createDestinatarioResolver({ consultar })

    await expect(resolver({ cnpj: CNPJ, razaoSocial: null })).resolves.toEqual({
      razaoSocial: 'SACADO CONSULTADO LTDA',
      source: 'cnpj_lookup',
    })
    expect(consultar).toHaveBeenCalledOnce()
    expect(consultar).toHaveBeenCalledWith(CNPJ)
  })

  it('compartilha consulta concorrente e reutiliza o resultado no mesmo runtime', async () => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const consultar = vi.fn(async () => {
      await waiting
      return { ok: true as const, dados: dadosCnpj('SACADO CACHE LTDA') }
    })
    const resolver = createDestinatarioResolver({ consultar })

    const first = resolver({ cnpj: CNPJ, razaoSocial: '' })
    const second = resolver({ cnpj: CNPJ, razaoSocial: '' })
    release()

    await expect(Promise.all([first, second])).resolves.toEqual([
      { razaoSocial: 'SACADO CACHE LTDA', source: 'cnpj_lookup' },
      { razaoSocial: 'SACADO CACHE LTDA', source: 'cnpj_lookup' },
    ])
    await resolver({ cnpj: CNPJ, razaoSocial: '' })
    expect(consultar).toHaveBeenCalledOnce()
  })

  it('nao consulta CNPJ invalido', async () => {
    const consultar = vi.fn()
    const resolver = createDestinatarioResolver({ consultar })

    await expect(resolver({ cnpj: '123', razaoSocial: '' })).resolves.toEqual({
      razaoSocial: '',
      source: 'unresolved',
    })
    expect(consultar).not.toHaveBeenCalled()
  })

  it('nao bloqueia a importacao quando o servico externo falha', async () => {
    const consultar = vi.fn().mockRejectedValue(new Error('network'))
    const resolver = createDestinatarioResolver({ consultar })

    await expect(resolver({ cnpj: CNPJ, razaoSocial: '' })).resolves.toEqual({
      razaoSocial: '',
      source: 'unresolved',
    })
  })
})
