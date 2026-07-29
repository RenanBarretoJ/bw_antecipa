import { describe, expect, it } from 'vitest'
import {
  buildListParams,
  buildListQuery,
  buildListUrl,
  buildOffsetRange,
  buildPaginatedResult,
  buildPaginationMeta,
  decodeCursor,
  encodeCursor,
  normalizePage,
  normalizePageSize,
  normalizarBusca,
  parseCursor,
  parsePaginationParams,
  parseSortParams,
} from './index'

const ID_A = '123e4567-e89b-42d3-a456-426614174000'
const ID_B = '123e4567-e89b-42d3-a456-426614174001'
const CREATED_AT = '2026-07-29T12:30:45.123456Z'

function encodeRawJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

describe('parâmetros de paginação', () => {
  it('usa defaults sem parâmetros', () => {
    expect(parsePaginationParams(undefined)).toEqual({ page: 1, pageSize: 10 })
  })

  it('aceita página válida', () => {
    expect(parsePaginationParams({ page: '7' }).page).toBe(7)
  })

  it('aceita inteiro com zeros à esquerda', () => {
    expect(parsePaginationParams({ page: '007' }).page).toBe(7)
  })

  it('aceita pageSize permitido', () => {
    expect(parsePaginationParams({ pageSize: '20' }).pageSize).toBe(20)
  })

  it('aceita URLSearchParams', () => {
    expect(parsePaginationParams(new URLSearchParams('page=2&pageSize=40')))
      .toEqual({ page: 2, pageSize: 40 })
  })

  it('usa o primeiro valor repetido em Record', () => {
    expect(parsePaginationParams({ page: ['3', '8'], pageSize: ['20', '40'] }))
      .toEqual({ page: 3, pageSize: 20 })
  })

  it('usa o primeiro valor repetido em URLSearchParams', () => {
    expect(parsePaginationParams(new URLSearchParams('page=4&page=9')))
      .toEqual({ page: 4, pageSize: 10 })
  })

  it.each(['abc', '0', '-1', '1.5', '1e2', '', '1000001'])(
    'rejeita página inválida %s',
    (page) => {
      expect(parsePaginationParams({ page }).page).toBe(1)
    },
  )

  it.each(['100', '0', '-20', '20.0', '', 'abc'])(
    'rejeita pageSize não permitido %s',
    (pageSize) => {
      expect(parsePaginationParams({ pageSize }).pageSize).toBe(10)
    },
  )

  it('respeita defaults customizados válidos', () => {
    expect(parsePaginationParams({}, { page: 3, pageSize: 40 }))
      .toEqual({ page: 3, pageSize: 40 })
  })

  it('normaliza valores numéricos diretos', () => {
    expect(normalizePage(5)).toBe(5)
    expect(normalizePageSize(20)).toBe(20)
  })
})

describe('range offset', () => {
  it('calcula página 1 com tamanho 10', () => {
    expect(buildOffsetRange({ page: 1, pageSize: 10 })).toEqual({ from: 0, to: 9 })
  })

  it('calcula página 2 com tamanho 10', () => {
    expect(buildOffsetRange({ page: 2, pageSize: 10 })).toEqual({ from: 10, to: 19 })
  })

  it('calcula página 3 com tamanho 20', () => {
    expect(buildOffsetRange({ page: 3, pageSize: 20 })).toEqual({ from: 40, to: 59 })
  })
})

describe('metadata de paginação', () => {
  it('representa total zero sem índices de UI', () => {
    expect(buildPaginationMeta({
      page: 1,
      pageSize: 10,
      total: 0,
      currentItemCount: 0,
    })).toMatchObject({
      page: 1,
      total: 0,
      totalPages: 0,
      from: 0,
      to: 0,
      hasPrevious: false,
      hasNext: false,
    })
  })

  it('representa página intermediária', () => {
    expect(buildPaginationMeta({
      page: 2,
      pageSize: 10,
      total: 35,
      currentItemCount: 10,
    })).toMatchObject({
      page: 2,
      totalPages: 4,
      from: 11,
      to: 20,
      hasPrevious: true,
      hasNext: true,
    })
  })

  it('representa última página parcial', () => {
    expect(buildPaginationMeta({
      page: 4,
      pageSize: 10,
      total: 35,
      currentItemCount: 5,
    })).toMatchObject({
      from: 31,
      to: 35,
      hasPrevious: true,
      hasNext: false,
    })
  })

  it('normaliza página acima do total e sinaliza o ajuste', () => {
    expect(buildPaginationMeta({
      page: 9,
      pageSize: 10,
      total: 22,
      currentItemCount: 0,
    })).toMatchObject({
      page: 3,
      requestedPage: 9,
      wasPageAdjusted: true,
      from: 0,
      to: 0,
    })
  })

  it('torna tratável página vazia após exclusão', () => {
    expect(buildPaginationMeta({
      page: 3,
      pageSize: 10,
      total: 20,
      currentItemCount: 0,
    })).toMatchObject({
      page: 2,
      requestedPage: 3,
      wasPageAdjusted: true,
      from: 0,
      to: 0,
    })
  })

  it('não aceita total ou contagem negativos', () => {
    expect(buildPaginationMeta({
      page: 1,
      pageSize: 10,
      total: -2,
      currentItemCount: -1,
    })).toMatchObject({ total: 0, totalPages: 0, from: 0, to: 0 })
  })

  it('monta resultado paginado tipado', () => {
    expect(buildPaginatedResult(['a', 'b'], {
      page: 1,
      pageSize: 10,
      total: 2,
    })).toMatchObject({
      items: ['a', 'b'],
      pagination: { from: 1, to: 2, total: 2 },
    })
  })
})

describe('busca', () => {
  it('remove espaços externos', () => {
    expect(normalizarBusca('  Empresa  ')).toBe('Empresa')
  })

  it('colapsa espaços internos', () => {
    expect(normalizarBusca('texto      com     espaços')).toBe('texto com espaços')
  })

  it('retorna vazio para ausência ou tipo inválido', () => {
    expect(normalizarBusca(undefined)).toBe('')
    expect(normalizarBusca(123)).toBe('')
  })

  it('limita a busca ao máximo configurado', () => {
    expect(normalizarBusca('abcdefghij', 5)).toBe('abcde')
  })

  it('preserva acentos e pontuação de CNPJ e chave', () => {
    const value = 'São José S.A. 00.262.371/0005-75 #NFe-123'
    expect(normalizarBusca(value)).toBe(value)
  })
})

describe('ordenação', () => {
  const fields = ['created_at', 'valor_bruto'] as const

  it('aceita campo permitido e inclui desempate por id', () => {
    expect(parseSortParams({
      sort: 'valor_bruto',
      direction: 'asc',
      allowedFields: fields,
      defaultField: 'created_at',
    })).toEqual({ field: 'valor_bruto', direction: 'asc', tieBreaker: 'id' })
  })

  it('rejeita campo fora da allowlist', () => {
    expect(parseSortParams({
      sort: 'drop_table',
      direction: 'desc',
      allowedFields: fields,
      defaultField: 'created_at',
    }).field).toBe('created_at')
  })

  it.each(['asc', 'desc'] as const)('aceita direção %s', (direction) => {
    expect(parseSortParams({
      sort: 'created_at',
      direction,
      allowedFields: fields,
      defaultField: 'created_at',
    }).direction).toBe(direction)
  })

  it('rejeita direção inválida', () => {
    expect(parseSortParams({
      sort: 'created_at',
      direction: 'random',
      allowedFields: fields,
      defaultField: 'created_at',
      defaultDirection: 'desc',
    }).direction).toBe('desc')
  })

  it('aplica defaults sem parâmetros', () => {
    expect(parseSortParams({
      sort: undefined,
      direction: undefined,
      allowedFields: fields,
      defaultField: 'created_at',
      defaultDirection: 'asc',
    })).toEqual({ field: 'created_at', direction: 'asc', tieBreaker: 'id' })
  })

  it('usa o primeiro valor de arrays repetidos', () => {
    expect(parseSortParams({
      sort: ['valor_bruto', 'created_at'],
      direction: ['asc', 'desc'],
      allowedFields: fields,
      defaultField: 'created_at',
    })).toMatchObject({ field: 'valor_bruto', direction: 'asc' })
  })
})

describe('cursor composto', () => {
  it('faz encode e decode do payload', () => {
    const cursor = encodeCursor({ createdAt: CREATED_AT, id: ID_A })
    expect(decodeCursor(cursor)).toEqual({ createdAt: CREATED_AT, id: ID_A })
  })

  it('produz cursor seguro para URL', () => {
    expect(encodeCursor({ createdAt: CREATED_AT, id: ID_A }))
      .toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('normaliza timestamp UTC para seis casas', () => {
    const cursor = encodeCursor({
      createdAt: '2026-07-29T12:30:45Z',
      id: ID_A,
    })
    expect(parseCursor(cursor)?.createdAt).toBe('2026-07-29T12:30:45.000000Z')
  })

  it('normaliza timezone explícito para UTC', () => {
    const cursor = encodeCursor({
      createdAt: '2026-07-29T09:30:45.123456-03:00',
      id: ID_A,
    })
    expect(parseCursor(cursor)?.createdAt).toBe(CREATED_AT)
  })

  it.each([
    'não-é-data',
    '2026-02-30T10:00:00Z',
    '2026-07-29',
    '2026-07-29T25:00:00Z',
    '2026-07-29T10:00:00+15:00',
  ])('rejeita timestamp inválido %s', (createdAt) => {
    const cursor = encodeRawJson({ createdAt, id: ID_A })
    expect(parseCursor(cursor)).toBeNull()
  })

  it('rejeita ID inválido', () => {
    const cursor = encodeRawJson({ createdAt: CREATED_AT, id: '123' })
    expect(parseCursor(cursor)).toBeNull()
  })

  it('rejeita JSON inválido', () => {
    expect(parseCursor('bmFvLWUtanNvbg')).toBeNull()
  })

  it.each(['%%%', 'a', '', 'com espaço'])('rejeita base64 inválido %s', (cursor) => {
    expect(parseCursor(cursor)).toBeNull()
  })

  it('rejeita campos ausentes', () => {
    expect(parseCursor(encodeRawJson({ createdAt: CREATED_AT }))).toBeNull()
  })

  it('rejeita campos extras', () => {
    expect(parseCursor(encodeRawJson({
      createdAt: CREATED_AT,
      id: ID_A,
      role: 'gestor',
    }))).toBeNull()
  })

  it('distingue timestamps iguais por IDs diferentes', () => {
    const cursorA = encodeCursor({ createdAt: CREATED_AT, id: ID_A })
    const cursorB = encodeCursor({ createdAt: CREATED_AT, id: ID_B })
    expect(cursorA).not.toBe(cursorB)
    expect(parseCursor(cursorA)?.id).toBe(ID_A)
    expect(parseCursor(cursorB)?.id).toBe(ID_B)
  })

  it('mantém round trip determinístico', () => {
    const first = encodeCursor({ createdAt: CREATED_AT, id: ID_A })
    const payload = parseCursor(first)
    expect(payload).not.toBeNull()
    expect(encodeCursor(payload!)).toBe(first)
  })

  it('não lança para entradas externas inválidas', () => {
    expect(() => decodeCursor({ cursor: 'inválido' })).not.toThrow()
    expect(decodeCursor({ cursor: 'inválido' })).toBeNull()
  })
})

describe('helpers de URL', () => {
  it('preserva filtros existentes', () => {
    expect(buildListQuery(
      new URLSearchParams('status=rascunho&cedente=123&page=1'),
      { page: 2 },
    )).toBe('status=rascunho&cedente=123&page=2')
  })

  it('altera somente a página', () => {
    expect(buildListParams({ page: '1', q: 'abc' }, { page: 3 }).get('page'))
      .toBe('3')
  })

  it('altera pageSize e volta para página 1', () => {
    const params = buildListParams({ page: '4', pageSize: '10' }, { pageSize: 20 })
    expect(params.get('page')).toBe('1')
    expect(params.get('pageSize')).toBe('20')
  })

  it('remove parâmetros vazios', () => {
    const params = buildListParams({ page: '2', status: 'ativo' }, {
      status: '   ',
      q: null,
    })
    expect(params.has('status')).toBe(false)
    expect(params.has('q')).toBe(false)
  })

  it('altera busca e volta para página 1', () => {
    const params = buildListParams({ page: '5', q: 'antiga' }, { q: 'nova' })
    expect(params.get('page')).toBe('1')
    expect(params.get('q')).toBe('nova')
  })

  it('altera filtro e volta para página 1', () => {
    const params = buildListParams(
      { pagina: '5', status: 'todos' },
      { status: 'aprovado' },
      { pageParam: 'pagina' },
    )
    expect(params.get('pagina')).toBe('1')
  })

  it('trata parâmetros de domínio como filtros por padrão', () => {
    const params = buildListParams(
      { page: '5', cedente: 'anterior' },
      { cedente: 'novo' },
    )
    expect(params.get('page')).toBe('1')
    expect(params.get('cedente')).toBe('novo')
  })

  it('altera ordenação e volta para página 1', () => {
    const params = buildListParams({ page: '8' }, {
      sort: 'valor_bruto',
      direction: 'asc',
    })
    expect(params.get('page')).toBe('1')
    expect(params.get('sort')).toBe('valor_bruto')
  })

  it('preserva filtros repetidos', () => {
    const params = buildListParams(
      new URLSearchParams('status=ativo&status=pendente'),
      { page: 2 },
    )
    expect(params.getAll('status')).toEqual(['ativo', 'pendente'])
  })

  it('monta URL completa sem acoplamento ao roteador', () => {
    expect(buildListUrl('/gestor/exemplo', { status: 'ativo' }, { page: 2 }))
      .toBe('/gestor/exemplo?status=ativo&page=2')
  })

  it('não adiciona interrogação quando não há parâmetros', () => {
    expect(buildListUrl('/gestor/exemplo', undefined, {}))
      .toBe('/gestor/exemplo')
  })
})
