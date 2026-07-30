import { describe, expect, it } from 'vitest'
import { parseFiltrosCedentesGestor } from './gestor-listagem'

describe('listagem paginada de cedentes do gestor', () => {
  it('normaliza pagina, limite, busca, status e ordenacao por allowlist', () => {
    const filtros = parseFiltrosCedentesGestor({
      page: '-2',
      pageSize: '500',
      q: '  Cedente   Exemplo ',
      status: 'DROP TABLE',
      sort: 'senha',
      direction: 'lateral',
    })
    expect(filtros).toMatchObject({
      page: 1,
      pageSize: 10,
      q: 'Cedente Exemplo',
      status: null,
      sort: 'created_at',
      direction: 'desc',
    })
  })

  it('aceita filtros controlados e politica UUID', () => {
    const filtros = parseFiltrosCedentesGestor({
      status: 'ativo',
      politica: '00000000-0000-4000-8000-000000000001',
      sort: 'razao_social',
      direction: 'asc',
      pageSize: '40',
    })
    expect(filtros.status).toBe('ativo')
    expect(filtros.politicaId).toBe('00000000-0000-4000-8000-000000000001')
    expect(filtros.sort).toBe('razao_social')
    expect(filtros.pageSize).toBe(40)
  })
})
