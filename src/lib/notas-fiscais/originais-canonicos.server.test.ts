import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  data: [] as unknown,
  error: null as unknown,
  rpc: vi.fn(),
  admin: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => {
  state.admin()
  return { rpc: state.rpc }
} }))

import { carregarOriginaisFiscaisCanonicos } from './originais-canonicos.server'

beforeEach(() => {
  vi.clearAllMocks()
  state.data = []
  state.error = null
  state.rpc.mockImplementation(async () => ({ data: state.data, error: state.error }))
})

describe('originais canônicos para o gate documental', () => {
  it('não consulta journal para coleção vazia ou somente notas legadas', async () => {
    expect(await carregarOriginaisFiscaisCanonicos([])).toEqual(new Map())
    expect(await carregarOriginaisFiscaisCanonicos([{ id: 'legacy', fiscal_reservation_id: null }])).toEqual(new Map())
    expect(state.admin).not.toHaveBeenCalled()
  })

  it('resolve PDF/XML em uma única consulta somente para IDs autorizados com reserva', async () => {
    state.data = [
      { nota_fiscal_id: 'pdf', bucket: 'documentos-v2', path: 'original.pdf' },
      { nota_fiscal_id: 'xml', bucket: 'notas-fiscais', path: 'original.xml' },
      { nota_fiscal_id: 'foreign', bucket: 'documentos-v2', path: 'foreign.pdf' },
    ]
    const notas = ['pdf', 'xml', 'pdf'].map(id => ({ id, fiscal_reservation_id: 'reservation' }))
    const result = await carregarOriginaisFiscaisCanonicos([...notas, { id: 'legacy', fiscal_reservation_id: null }])
    expect([...result]).toEqual([['pdf', 'original.pdf'], ['xml', 'original.xml']])
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith('fiscal_intake_get_originals', { p_nf_ids: ['pdf', 'xml'] })
  })

  it.each([null, {}, { bucket: 'public', path: 'nota.pdf' }, { bucket: 'documentos-v2', path: '' },
    { bucket: 'documentos-v2', path: 7 }, { bucket: 'documentos-v2', path: 'photo.png' }])(
    'não promove uma referência inválida a original válido: %j', async row => {
      state.data = [row && { nota_fiscal_id: 'nf', ...row }]
      expect(await carregarOriginaisFiscaisCanonicos([{ id: 'nf', fiscal_reservation_id: 'reservation' }])).toEqual(new Map())
    },
  )

  it.each(['rpc', 'response'])('bloqueia falhas de infraestrutura sem expor detalhes: %s', async failure => {
    if (failure === 'rpc') state.error = { message: 'PRIVATE_SQL_DETAIL' }
    else state.data = null
    await expect(carregarOriginaisFiscaisCanonicos([{ id: 'nf', fiscal_reservation_id: 'reservation' }]))
      .rejects.toThrow('Não foi possível validar os arquivos originais. Tente novamente em instantes.')
  })
})
