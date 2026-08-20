import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
}))

function chain(rows: unknown[]) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    not: () => query,
    order: () => query,
    then: (resolve: (result: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  }
  return query
}

function fakeSupabase() {
  return {
    from: (table: string) => chain(mocks.tables[table] || []),
  }
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/authorization', () => ({
  requireNotaFiscalAccess: vi.fn(async () => ({
    supabase: fakeSupabase(),
    user: { id: 'user-1' },
    profile: { role: 'cedente' },
  })),
  requireGestor: vi.fn(async () => ({ supabase: fakeSupabase(), user: { id: 'gestor-1' } })),
}))
vi.mock('@/lib/auth/mfa', () => ({ exigirSessaoElevada: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./notificacao', () => ({ notificarCedente: vi.fn() }))
vi.mock('./auditoria', () => ({ registrarLog: vi.fn(async () => undefined) }))

import { listarParcelasBoletosDaNota } from './parcelas-nf'

describe('listarParcelasBoletosDaNota', () => {
  beforeEach(() => {
    mocks.tables = {}
  })

  it('NF com parcelas mas politica SEM boleto retorna lista vazia (nao inventa itens pendentes)', async () => {
    mocks.tables.nota_fiscal_parcelas = [
      { id: 'p1', nota_fiscal_id: 'nf-1', numero_parcela: 1, valor_nominal: 100, data_vencimento: '2026-10-01' },
      { id: 'p2', nota_fiscal_id: 'nf-1', numero_parcela: 2, valor_nominal: 100, data_vencimento: '2026-11-01' },
      { id: 'p3', nota_fiscal_id: 'nf-1', numero_parcela: 3, valor_nominal: 100, data_vencimento: '2026-12-01' },
    ]
    mocks.tables.documento_requisito_instancias = []

    const result = await listarParcelasBoletosDaNota('nf-1')

    expect(result.success).toBe(true)
    expect(result.data).toEqual([])
  })

  it('NF com parcelas e politica COM boleto retorna exatamente 1 item por parcela com requisito real', async () => {
    mocks.tables.nota_fiscal_parcelas = [
      { id: 'p1', nota_fiscal_id: 'nf-1', numero_parcela: 1, valor_nominal: 100, data_vencimento: '2026-10-01' },
      { id: 'p2', nota_fiscal_id: 'nf-1', numero_parcela: 2, valor_nominal: 100, data_vencimento: '2026-11-01' },
    ]
    mocks.tables.documento_requisito_instancias = [
      { id: 'req-1', parcela_id: 'p1', obrigatorio: true, status: 'pendente', documento_id: null, tipo_documento_codigo_snapshot: 'boleto' },
      { id: 'req-2', parcela_id: 'p2', obrigatorio: true, status: 'satisfeito', documento_id: 'doc-2', tipo_documento_codigo_snapshot: 'boleto' },
    ]
    mocks.tables.documento_versoes = [
      { id: 'v2', documento_id: 'doc-2', numero_versao: 1, nome_original: 'boleto-002.pdf', beneficiario_estabelecimento_id: 'est-1' },
    ]
    mocks.tables.documento_analises = []

    const result = await listarParcelasBoletosDaNota('nf-1')

    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(2)
    expect(result.data?.map((item) => item.parcela.numero_parcela)).toEqual([1, 2])
    expect(result.data?.every((item) => item.obrigatorio)).toBe(true)
    expect(result.data?.[1].status).toBe('satisfeito')
    expect(result.data?.[1].documentoVersaoId).toBe('v2')
  })

  it('NF sem nenhuma parcela retorna lista vazia sem consultar requisitos', async () => {
    mocks.tables.nota_fiscal_parcelas = []

    const result = await listarParcelasBoletosDaNota('nf-2')

    expect(result.success).toBe(true)
    expect(result.data).toEqual([])
  })
})
