import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ client: vi.fn(), resolver: vi.fn(), bootstrap: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: state.client }))
vi.mock('@/lib/integracoes/resolver.server', () => ({ integrationRuntimeEnvironment: () => 'homologacao', resolverIntegracaoPorCapability: state.resolver }))
vi.mock('@/lib/financeiro/bootstrap/detector.server', () => ({ resolverBootstrapFinanceiro: state.bootstrap }))
import { executarMatchingFinanceiro, executarConciliacaoFinanceira } from '../conciliacao/processor.server'

type Row = Record<string, unknown>

function database(rows: Record<string, Row[]>) {
  const captured: { name: string; payload: Row }[] = []
  const readTables: string[] = []
  class Query {
    selected: Row[]
    single = false
    constructor(table: string) { readTables.push(table); this.selected = [...(rows[table] ?? [])] }
    select() { return this }
    eq(key: string, value: unknown) { this.selected = this.selected.filter(r => r[key] === value); return this }
    in(key: string, values: unknown[]) { this.selected = this.selected.filter(r => values.includes(r[key])); return this }
    order() { return this }
    limit(n: number) { this.selected = this.selected.slice(0, n); return this }
    range(from: number, to: number) { this.selected = this.selected.slice(from, to + 1); return this }
    maybeSingle() { this.single = true; return this }
    or(filter: string) {
      if (filter === 'provedor.neq.VORTX') this.selected = this.selected.filter(r => r.provedor !== 'VORTX')
      else {
        const scope = /^and\(provedor.eq.VORTX,fonte_ambiente.eq.([^,]+),fonte_carteira.eq.([^)]+)\)$/.exec(filter)
        if (!scope) throw new Error('Unexpected source filter')
        this.selected = this.selected.filter(r => r.provedor === 'VORTX' && r.fonte_ambiente === scope[1] && r.fonte_carteira === scope[2])
      }
      return this
    }
    then<T>(resolve: (result: { data: Row[] | Row | null; error: null }) => T): Promise<T> {
      return Promise.resolve(resolve({ data: this.single ? this.selected[0] ?? null : this.selected, error: null }))
    }
  }
  return { captured, readTables, from: (table: string) => new Query(table),
    rpc: async (name: string, args: { p_payload: Row }) => {
      if (name === 'financeiro_possui_historico_fonte_vortx') return { data: false, error: null }
      captured.push({ name, payload: args.p_payload }); return { data: 'execucao-qa', error: null }
    } }
}

const fund = '61f02178-58af-4bfa-9a33-f97ac5b3dd96'
const input = { fundoId: fund, dataReferencia: '2026-10-16', atorUsuarioId: 'gestor-qa' }
const header = (id: string, provedor: string, extra: Row = {}) => ({
  id, fundo_id: fund, tipo_base: 'ESTOQUE', data_referencia: input.dataReferencia, provedor,
  status: 'PUBLICADA', completude: 'COMPLETO_COM_DADOS', publicada_em: '2026-10-19',
  ...(provedor === 'VORTX' ? { fonte_ambiente: 'homologacao', fonte_carteira: 'C-01' } : {}), ...extra,
})
const position = (id: string, importId: string, provedor: string) => ({
  id, importacao_id: importId, fundo_id: fund, provedor, id_recebivel: `QA:${id}`,
  cedente_documento: '98992300000280', sacado_documento: '98992300000360', valor_nominal: '100', valor_aquisicao: '90',
})

describe('orquestracao financeira por fonte', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.resolver.mockResolvedValue({ status: 'CONFIGURADA', integrationVersion: { providerKey: 'VORTX', adapterKey: 'vortx_vrs', config: { codigo_carteira: 'C-01' } } })
    state.bootstrap.mockResolvedValue({ fundoVirgem: false })
  })
  it('matching usa somente parcelas da fonte correta, mesmo com legado publicado na mesma data', async () => {
    const db = database({
      importacoes_financeiras: [header('fromtis', 'FROMTIS'), header('native', 'VORTX'), header('wrong-env', 'VORTX', { fonte_ambiente: 'producao' }), header('wrong-wallet', 'VORTX', { fonte_carteira: 'OTHER' })],
      estoque_fontes_leitura: [position('old-1', 'fromtis', 'FROMTIS'), position('native-1', 'native', 'VORTX'), position('native-2', 'native', 'VORTX')],
    })
    state.client.mockReturnValue(db)
    expect((await executarMatchingFinanceiro(input)).total).toBe(2)
    expect(db.captured[0].payload.input_import_ids).toEqual(['native'])
    expect((db.captured[0].payload.resultados as Row[]).map(r => r.origem_registro_id)).toEqual(['native-1', 'native-2'])
    expect(db.readTables).not.toContain('estoque_posicoes')
  })
  it('matching legado continua usando a mesma projecao sem incorporar Vortx', async () => {
    state.resolver.mockResolvedValue({ status: 'NAO_CONFIGURADA' })
    const db = database({ importacoes_financeiras: [header('native', 'VORTX'), header('legacy', 'FROMTIS')],
      estoque_fontes_leitura: [position('legacy-1', 'legacy', 'FROMTIS'), position('native-1', 'native', 'VORTX')] })
    state.client.mockReturnValue(db)
    expect((await executarMatchingFinanceiro(input)).total).toBe(1)
    expect(db.captured[0].payload.input_import_ids).toEqual(['legacy'])
  })
  it('ausencia de posicao nativa nao usa legado nem chama persistencia', async () => {
    const db = database({ importacoes_financeiras: [header('legacy', 'FROMTIS')] }); state.client.mockReturnValue(db)
    await expect(executarMatchingFinanceiro(input)).rejects.toThrow('Nenhuma base financeira')
    expect(db.captured).toHaveLength(0)
  })
  it('conciliacao nao usa aquisicoes/liquidacoes Fromtis para completar estoque Vortx', async () => {
    const db = database({ importacoes_financeiras: [header('native', 'VORTX'),
      header('acq', 'FROMTIS', { tipo_base: 'AQUISICOES' }), header('liq', 'FROMTIS', { tipo_base: 'LIQUIDACOES' })] })
    state.client.mockReturnValue(db)
    expect((await executarConciliacaoFinanceira(input)).status).toBe('BASE_INCOMPLETA')
    expect(db.captured[0].payload.input_import_ids).toEqual(['native'])
    expect(db.captured[0].payload.resultados).toEqual([])
  })
})
