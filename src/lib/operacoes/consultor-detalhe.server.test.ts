import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError } from '@/lib/auth/authorization'
import { carregarDetalheOperacaoCedente } from './cedente-detalhe.server'

const mocks = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/auth/authorization', async (original) => ({
  ...await original<typeof import('@/lib/auth/authorization')>(),
  requireOperationAccess: mocks.access,
}))

const ID = '12d88186-f3cf-474f-a5fd-ea5c4da85257'
const op = {
  id: ID, cedente_id: 'cedente-qa', cedente_fundo_id: 'cf-qa',
  valor_bruto_total: 100, valor_liquido_desembolso: null, taxa_desconto: null,
  prazo_dias: 30, data_vencimento: '2026-11-23', status: 'solicitada',
  created_at: '2026-10-23T12:00:00Z', cedentes: { razao_social: 'Cedente QA', cnpj: '00000000000191' },
}
let role: 'consultor' | 'cedente'
let fundVisible: boolean
let linkStatus: string
let opVisible: boolean
let linkError: boolean
let fundGrant: boolean

beforeEach(() => {
  vi.clearAllMocks()
  role = 'consultor'; fundVisible = true; linkStatus = 'ativo'; opVisible = true; linkError = false; fundGrant = true
  mocks.access.mockImplementation(async () => ({
    profile: { role }, operacao: { id: ID, cedente_id: op.cedente_id },
    supabase: { from: mocks.from },
  }))
  mocks.from.mockImplementation((table: string) => {
    const data = table === 'operacoes' ? (opVisible ? op : null)
      : table === 'cedente_fundos' ? { id: 'cf-qa', cedente_id: op.cedente_id, fundo_id: 'fund-qa', status: linkStatus }
      : table === 'fundos' ? (fundVisible ? { id: 'fund-qa' } : null)
      : table === 'consultor_cedentes' ? [{ consultor_id: 'org-qa' }]
      : table === 'consultor_fundos' ? (fundGrant ? { consultor_id: 'org-qa' } : null) : []
    const result = { data, error: table === 'operacoes_nfs' && linkError ? { message: 'Infrastructure error' } : null }
    const chain = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    }
    return chain
  })
})

describe('detalhe consultor: leitura autorizada por cedente e fundo', () => {
  it('carrega a operação com o cliente da sessão sem efetuar escrita', async () => {
    const result = await carregarDetalheOperacaoCedente(ID, { perfil: 'consultor' })
    expect(result.id).toBe(ID)
    expect(result.financeiro.valorBrutoSolicitado).toBe(100)
    expect(mocks.access).toHaveBeenCalledWith(ID)
    expect(mocks.from).toHaveBeenCalledWith('fundos')
  })
  it('rejeita outro perfil antes das consultas do detalhe', async () => {
    role = 'cedente'
    await expect(carregarDetalheOperacaoCedente(ID, { perfil: 'consultor' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('rejeita UUID adulterado antes da consulta de acesso', async () => {
    await expect(carregarDetalheOperacaoCedente('id-forjado', { perfil: 'consultor' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mocks.access).not.toHaveBeenCalled()
  })
  it('preserva a negativa do guard canônico para cedente de outra consultoria', async () => {
    mocks.access.mockRejectedValue(new AuthorizationError('Negado', 'NOT_FOUND'))
    await expect(carregarDetalheOperacaoCedente(ID, { perfil: 'consultor' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('não permite consultar operação de outro fundo mesmo com acesso ao cedente', async () => {
    fundVisible = false
    await expect(carregarDetalheOperacaoCedente(ID, { perfil: 'consultor' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mocks.from).not.toHaveBeenCalledWith('operacoes_nfs')
  })
  it('rejeita vínculo suspenso ou encerrado', async () => {
    linkStatus = 'encerrado'
    await expect(carregarDetalheOperacaoCedente(ID, { perfil: 'consultor' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('não combina vínculo do Cedente de uma consultoria com Fundo de outra', async () => {
    fundGrant = false
    await expect(carregarDetalheOperacaoCedente(ID, { perfil: 'consultor' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const index = mocks.from.mock.calls.findIndex(([table]) => table === 'consultor_fundos')
    expect(mocks.from.mock.results[index].value.in).toHaveBeenCalledWith('consultor_id', ['org-qa'])
    expect(mocks.from).not.toHaveBeenCalledWith('operacoes_nfs')
  })
  it('não inventa uma operação quando a RLS não a retorna', async () => {
    opVisible = false
    await expect(carregarDetalheOperacaoCedente(ID, { perfil: 'consultor' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('não converte erro de consulta em ausência de notas', async () => {
    linkError = true
    await expect(carregarDetalheOperacaoCedente(ID, { perfil: 'consultor' })).rejects.toThrow('Não foi possível carregar as notas fiscais')
  })
})
