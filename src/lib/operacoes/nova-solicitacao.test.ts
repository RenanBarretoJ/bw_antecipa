import { describe, expect, it } from 'vitest'
import { parseFiltrosNovaSolicitacao } from './nova-solicitacao'

describe('filtros da nova solicitacao de operacao', () => {
  it('usa os defaults do Escopo 0', () => {
    expect(parseFiltrosNovaSolicitacao({})).toEqual({
      page: 1,
      pageSize: 10,
      q: '',
      sort: 'data_vencimento',
      direction: 'asc',
    })
  })

  it('normaliza busca, paginacao e ordenacao por allowlist', () => {
    expect(parseFiltrosNovaSolicitacao({
      page: '2',
      pageSize: '20',
      q: '  NF   13197 ',
      sort: 'valor_bruto',
      direction: 'desc',
    })).toEqual({
      page: 2,
      pageSize: 20,
      q: 'NF 13197',
      sort: 'valor_bruto',
      direction: 'desc',
    })
  })

  it('rejeita parametros fora das allowlists', () => {
    expect(parseFiltrosNovaSolicitacao({
      page: '0',
      pageSize: '500',
      sort: 'senha',
      direction: 'drop',
    })).toMatchObject({
      page: 1,
      pageSize: 10,
      sort: 'data_vencimento',
      direction: 'asc',
    })
  })
})
