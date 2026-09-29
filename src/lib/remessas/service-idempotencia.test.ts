import { beforeEach, expect, it, vi } from 'vitest'
import { gerarRemessaOperacional } from './service.server'
import { hashRemessa, stableStringify } from './domain'

const mocks = vi.hoisted(() => ({ from: vi.fn(), loader: vi.fn(), upload: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: mocks.from, storage: { from: () => ({ upload: mocks.upload }) } }) }))
vi.mock('./loader.server', () => ({ carregarLoteRemessaCanonico: mocks.loader }))
vi.mock('@/lib/actions/auditoria', () => ({ registrarLog: vi.fn() }))
const lote = {
  fundo: { id: 'fundo' }, integracao: { adapterKey: 'vortx_vrs', versaoId: 'versao' },
  operacoes: [{ notas: [{ devedor: { endereco: 'Rua consultada', fonteEndereco: 'cnpj' } }] }],
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.loader.mockResolvedValue(structuredClone(lote))
  mocks.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: { id: 'remessa-original', payload_hash: hashRemessa(stableStringify(lote)) }, error: null }),
    single: async () => ({ data: { id: 'remessa-original', adapter_key: 'vortx_vrs', estrategia_agrupamento: 'POR_CEDENTE', excel_storage_path: 'original.xlsx' }, error: null }),
    order: async () => ({ data: table === 'remessa_operacional_arquivos' ? [] : null, error: null }),
  }) }) }))
})
it('reutiliza a remessa persistida sem upload para payload identico', async () => {
  const result = await gerarRemessaOperacional({ operacaoIds: ['op'], userId: 'gestor' })
  expect(result).toMatchObject({ remessaId: 'remessa-original', idempotentReplay: true })
  expect(mocks.upload).not.toHaveBeenCalled()
})
it('bloqueia alteracao de endereco externo na mesma cessao', async () => {
  const alterado = structuredClone(lote)
  alterado.operacoes[0].notas[0].devedor.endereco = 'Rua externa mudou'
  mocks.loader.mockResolvedValue(alterado)
  await expect(gerarRemessaOperacional({ operacaoIds: ['op'], userId: 'gestor' })).rejects.toThrow(/payload diferente/)
  expect(mocks.upload).not.toHaveBeenCalled()
})
