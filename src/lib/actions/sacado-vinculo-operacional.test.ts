import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolverContextoSacado: vi.fn(),
  revalidatePath: vi.fn(),
  registrarLog: vi.fn(),
  notificarGestores: vi.fn(),
  carregarContextoEventoOperacao: vi.fn(),
  registrarEventoDominio: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/sacado/contexto.server', () => ({
  resolverContextoSacado: mocks.resolverContextoSacado,
  normalizarCnpjSacado: (value: string) => value.replace(/\D/g, ''),
}))
vi.mock('@/lib/eventos-dominio/registrar', () => ({
  carregarContextoEventoOperacao: mocks.carregarContextoEventoOperacao,
  registrarEventoDominio: mocks.registrarEventoDominio,
}))
vi.mock('./auditoria', () => ({ registrarLog: mocks.registrarLog }))
vi.mock('./notificacao', () => ({ notificarGestores: mocks.notificarGestores }))

import { aprovarCessao, aprovarCessaoLote, contestarCessao } from './sacado'

type Link = { nota_fiscal_id: string; operacao_id: string }
type Operation = {
  id: string
  status: string
  aceite_sacado_exigido: boolean
  aceite_sacado_status: string
}

const active = (id: string): Operation => ({
  id,
  status: 'solicitada',
  aceite_sacado_exigido: true,
  aceite_sacado_status: 'pendente',
})

function prepararCenario(nfIds: string[], links: Link[], operations: Operation[]) {
  const dataByTable: Record<string, unknown[]> = {
    notas_fiscais: nfIds.map((id) => ({ id, status: 'em_antecipacao', cnpj_destinatario: '11222333000181' })),
    operacoes_nfs: links,
    operacoes: operations,
  }
  const supabase = {
    from(table: string) {
      return {
        select() {
          return {
            async in(column: string, ids: string[]) {
              return {
                data: (dataByTable[table] ?? []).filter((row) => ids.includes((row as Record<string, string>)[column])),
                error: null,
              }
            },
          }
        },
      }
    },
    rpc: mocks.rpc,
  }
  mocks.resolverContextoSacado.mockResolvedValue({ auth: { supabase }, cnpj: '11222333000181' })
}

describe('aceite do sacado com operação cancelada no histórico', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: { operacao_ids: ['atual'] }, error: null })
  })

  it('aprova individualmente a NF apenas pela operação solicitada atual', async () => {
    prepararCenario(['nf1'], [
      { nota_fiscal_id: 'nf1', operacao_id: 'antiga' },
      { nota_fiscal_id: 'nf1', operacao_id: 'atual' },
    ], [{ ...active('antiga'), status: 'cancelada' }, active('atual')])

    expect(await aprovarCessao('nf1')).toMatchObject({ success: true })
    expect(mocks.rpc).toHaveBeenCalledWith('processar_aceite_sacado', {
      p_nota_fiscal_ids: ['nf1'], p_acao: 'aceitar', p_motivo: null,
    })
  })

  it('aprova lote de NFs com histórico cancelado sem duplicar IDs', async () => {
    prepararCenario(['nf1', 'nf2'], [
      { nota_fiscal_id: 'nf1', operacao_id: 'antiga' },
      { nota_fiscal_id: 'nf1', operacao_id: 'atual' },
      { nota_fiscal_id: 'nf2', operacao_id: 'antiga' },
      { nota_fiscal_id: 'nf2', operacao_id: 'atual' },
    ], [{ ...active('antiga'), status: 'cancelada' }, active('atual')])

    expect(await aprovarCessaoLote(['nf1', 'nf2', 'nf1'])).toMatchObject({ success: true, aprovadas: 2 })
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('bloqueia duas operações ativas reais antes da RPC', async () => {
    prepararCenario(['nf1'], [
      { nota_fiscal_id: 'nf1', operacao_id: 'op1' },
      { nota_fiscal_id: 'nf1', operacao_id: 'op2' },
    ], [active('op1'), active('op2')])

    expect(await aprovarCessao('nf1')).toMatchObject({ success: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('não aprova operação antiga cancelada sem nova operação', async () => {
    prepararCenario(['nf1'], [{ nota_fiscal_id: 'nf1', operacao_id: 'antiga' }], [
      { ...active('antiga'), status: 'cancelada' },
    ])
    expect(await aprovarCessao('nf1')).toMatchObject({ success: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('não aprova operação já aprovada, mesmo com histórico cancelado', async () => {
    prepararCenario(['nf1'], [
      { nota_fiscal_id: 'nf1', operacao_id: 'antiga' },
      { nota_fiscal_id: 'nf1', operacao_id: 'atual' },
    ], [{ ...active('antiga'), status: 'cancelada' }, { ...active('atual'), status: 'aprovada' }])
    expect(await aprovarCessao('nf1')).toMatchObject({ success: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('permite contestação da operação atual sem tocar a cancelada', async () => {
    prepararCenario(['nf1'], [
      { nota_fiscal_id: 'nf1', operacao_id: 'antiga' },
      { nota_fiscal_id: 'nf1', operacao_id: 'atual' },
    ], [{ ...active('antiga'), status: 'cancelada' }, active('atual')])

    expect(await contestarCessao('nf1', 'Divergencia fiscal')).toMatchObject({ success: true })
    expect(mocks.rpc).toHaveBeenCalledWith('processar_aceite_sacado', {
      p_nota_fiscal_ids: ['nf1'], p_acao: 'contestar', p_motivo: 'Divergencia fiscal',
    })
  })
})
