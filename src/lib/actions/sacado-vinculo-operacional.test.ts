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

import { aprovarCessao, aprovarCessaoLote, contestarCessao, contestarCessaoLote } from './sacado'

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
    notas_fiscais: nfIds.map((id) => ({ id, status: 'em_antecipacao', cnpj_destinatario: '11222333000181', fundo_id: 'fundo-qa' })),
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
  mocks.resolverContextoSacado.mockResolvedValue({ auth: { supabase }, acessos: [{ user_id: 'qa', sacado_id: 'empresa-qa', cnpj: '11222333000181', razao_social: 'QA', fundo_id: 'fundo-qa', status: 'ativo' }] })
  return dataByTable
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

  it.each(['aceitar', 'contestar'])('permite %s as NFs restantes após contestação parcial', async (acao) => {
    prepararCenario(['nf2'], [{ nota_fiscal_id: 'nf2', operacao_id: 'atual' }], [
      { ...active('atual'), aceite_sacado_status: 'contestado' },
    ])
    const result = acao === 'aceitar'
      ? await aprovarCessao('nf2')
      : await contestarCessao('nf2', 'Divergencia')
    expect(result).toMatchObject({ success: true })
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('contesta lote em uma RPC, deduplicando IDs e preservando o motivo', async () => {
    prepararCenario(['nf1', 'nf2'], [
      { nota_fiscal_id: 'nf1', operacao_id: 'atual' },
      { nota_fiscal_id: 'nf2', operacao_id: 'atual' },
    ], [active('atual')])
    expect(await contestarCessaoLote(['nf1', 'nf2', 'nf1'], '  Divergencia fiscal  ')).toMatchObject({ success: true })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('processar_aceite_sacado', {
      p_nota_fiscal_ids: ['nf1', 'nf2'], p_acao: 'contestar', p_motivo: 'Divergencia fiscal',
    })
  })

  it('rejeita motivo vazio, seleção vazia e lote acima de 500 sem acessar o banco', async () => {
    expect(await contestarCessaoLote(['nf1'], '  ')).toMatchObject({ success: false })
    expect(await contestarCessaoLote([], 'Motivo')).toMatchObject({ success: false })
    expect(await contestarCessaoLote(Array.from({ length: 501 }, (_, i) => `nf${i}`), 'Motivo')).toMatchObject({ success: false })
    expect(mocks.resolverContextoSacado).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'contestada' },
    { status: 'aceita' },
    { fundo_id: 'outro-fundo' },
    { cnpj_destinatario: '99888777000166' },
  ])('rejeita o lote inteiro quando uma NF não permite decisão: %o', async (alteracao) => {
    const data = prepararCenario(['nf1', 'nf2'], [
      { nota_fiscal_id: 'nf1', operacao_id: 'atual' },
      { nota_fiscal_id: 'nf2', operacao_id: 'atual' },
    ], [active('atual')])
    Object.assign(data.notas_fiscais[1] as object, alteracao)
    expect(await contestarCessaoLote(['nf1', 'nf2'], 'Motivo')).toMatchObject({ success: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('não informa sucesso nem revalida quando a transação falha', async () => {
    prepararCenario(['nf1'], [{ nota_fiscal_id: 'nf1', operacao_id: 'atual' }], [active('atual')])
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Esta NF nao pode ser alterada no status atual.' } })
    expect(await contestarCessaoLote(['nf1'], 'Motivo')).toMatchObject({ success: false })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('não expõe detalhes SQL em erros inesperados', async () => {
    prepararCenario(['nf1'], [{ nota_fiscal_id: 'nf1', operacao_id: 'atual' }], [active('atual')])
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'PRIVATE_SQL_DETAIL select secret from private_table' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const result = await contestarCessaoLote(['nf1'], 'Motivo')
      expect(result).toMatchObject({ success: false })
      expect(result?.message).not.toContain('PRIVATE_SQL_DETAIL')
      expect(spy).toHaveBeenCalledWith('[sacado/aceite] Falha ao processar decisao.', { code: 'XX000' })
    } finally {
      spy.mockRestore()
    }
  })
})
