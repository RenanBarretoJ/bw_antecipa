import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { healthDetailFixture } from './health-detail.fixture'

// Replay the component's state between awaited loader responses. Child components
// keep real React hooks; neither the fiscal lookup nor pricing is mocked.
const replay = vi.hoisted(() => ({ states: new Map<number, unknown>(), cursor: 0 }))
vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>()
  return { ...real, useState: (initial: unknown) => {
    const index = replay.cursor++
    return real.useState(replay.states.has(index) ? replay.states.get(index) : initial)
  } }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/actions/operacao', () => ({ aprovarOperacao: vi.fn(), desembolsarOperacao: vi.fn(), listarTestemunhasOperacao: vi.fn(), reprovarOperacao: vi.fn(), removerNfDaOperacao: vi.fn(), salvarTestemunhasOperacao: vi.fn(), salvarQuitacaoAssinada: vi.fn() }))
vi.mock('@/lib/actions/liquidacao', () => ({ liquidarOperacao: vi.fn(), marcarInadimplente: vi.fn() }))
vi.mock('@/lib/actions/logistica', () => ({ carregarResumoEntregaPorOperacao: vi.fn() }))
vi.mock('@/components/notifications/notification-provider', () => ({ useNotifications: () => ({ notify: vi.fn() }) }))
vi.mock('@/components/fundos/fundo-ativo-provider', () => ({ useFundoAtivo: () => ({ loading: false, bloqueado: false, fundoAtivo: { id: 'qa-fundo' } }) }))
vi.mock('@/components/contratos/BotaoDownloadContrato', () => ({ BotaoDownloadContrato: () => null }))
vi.mock('@/components/contratos/UploadDocumentoAssinado', () => ({ UploadDocumentoAssinado: () => null }))
vi.mock('@/components/contratos/UploadDocumentoAssinadoOperacao', () => ({ UploadDocumentoAssinadoOperacao: () => null }))
vi.mock('@/components/historico/HistoricoTimelineCard', () => ({ HistoricoTimelineCard: () => null }))
vi.mock('@/components/operacoes/AcompanhamentoLogisticoOperacao', () => ({ AcompanhamentoLogisticoOperacao: () => null, normalizarFiltroLogistico: () => 'todos' }))
vi.mock('@/components/operacoes/ExposicaoLogisticaOperacaoServer', () => ({ ExposicaoLogisticaOperacaoServer: () => null }))
vi.mock('@/lib/operacoes/data-operacional.server', () => ({ obterDataCivilOperacional: () => '2026-10-02' }))

import OperacaoDetalheGestorClient from './OperacaoDetalheGestorClient'
import OperacaoDetalheGestorPage from './page'

function render(fixture: ReturnType<typeof healthDetailFixture>, loading: boolean, withParcelas: boolean) {
  replay.cursor = 0
  replay.states = new Map<number, unknown>([
    [0, fixture.operacao], [1, fixture.notas],
    [6, withParcelas ? fixture.parcelas : new Map()],
    [7, withParcelas ? new Map(fixture.notas.map((nf) => [nf.id, 1])) : new Map()],
    [9, loading],
  ])
  return renderToStaticMarkup(createElement(OperacaoDetalheGestorClient, {
    opId: fixture.operacao.id, returnTo: '/gestor/operacoes', dataBaseServidor: '2026-10-02',
    acompanhamentoLogistico: null, exposicaoLogistica: null,
  }))
}

describe('Health operation detail - staged loader render regression', () => {
  beforeEach(() => { replay.cursor = 0; replay.states.clear() })

  it('keeps loading render safe when 15 NFs arrive before their ceded parcels', () => {
    const fixture = healthDetailFixture()
    const before = JSON.stringify(fixture)
    expect(() => render(fixture, true, false)).not.toThrow()
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it('renders the server route composition with the completed client fixture', async () => {
    const fixture = healthDetailFixture()
    const page = await OperacaoDetalheGestorPage({
      params: Promise.resolve({ id: fixture.operacao.id }),
      searchParams: Promise.resolve({ returnTo: '/gestor/operacoes' }),
    })
    render(fixture, false, true)
    replay.cursor = 0
    expect(renderToStaticMarkup(page)).toContain('CEDENTE QA HEALTH')
    expect(page.props.returnTo).toBe('/gestor/operacoes')
    expect(page.props.dataBaseServidor).toBe('2026-10-02')
  })

  it.each([null, 'NFE', 'NFSE', 'OUTRO'])('renders completed load with fiscal type %s', (tipo) => {
    const fixture = healthDetailFixture(tipo)
    const before = JSON.stringify(fixture)
    const html = render(fixture, false, true)
    expect(html).toContain('CEDENTE QA HEALTH')
    expect(html).toContain('QA-15')
    expect(html).toContain('558.579,15')
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it.each(['solicitada', 'em_analise', 'em_andamento', 'aprovada', 'reprovada', 'cancelada', 'liquidada'])('renders status %s without changing stored values', (status) => {
    const fixture = healthDetailFixture()
    fixture.operacao.status = status
    const before = JSON.stringify(fixture)
    expect(render(fixture, false, true)).toContain('QA-15')
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it('renders legacy operation without base snapshot', () => {
    const fixture = healthDetailFixture()
    fixture.operacao.base_antecipacao_snapshot = null
    expect(render(fixture, false, false)).toContain('QA-15')
  })

  it('renders multiple ceded parcels per NF with their original frozen values', () => {
    const fixture = healthDetailFixture()
    const first = fixture.notas[0]
    fixture.snapshot.itens[0].valor_base = first.valor_bruto / 2
    fixture.snapshot.itens.push({ nota_fiscal_id: first.id, parcela_id: `${first.id}-p2`,
      valor_base: first.valor_bruto / 2, vencimento: first.data_vencimento })
    fixture.parcelas.set(first.id, [1, 2].map((numeroParcela) => ({
      parcelaId: `${first.id}-p${numeroParcela}`, numeroParcela,
      valorNominal: first.valor_bruto / 2, dataVencimento: first.data_vencimento,
      diasAplicados: null, valorPresente: null, desconto: null,
    })))
    const before = JSON.stringify(fixture)
    expect(render(fixture, false, true)).toContain('QA-15')
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it('does not hide a genuinely missing snapshot item after loading', () => {
    const fixture = healthDetailFixture()
    fixture.snapshot.itens = []
    expect(() => render(fixture, false, true)).toThrow('base de antecipação congelada')
  })
})
