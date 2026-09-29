import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsultorDashboardData, ConsultorRelatorioData } from './contracts'
import { buildPaginatedResult } from '@/lib/pagination'

const mocks = vi.hoisted(() => ({ dashboard: vi.fn(), relatorio: vi.fn() }))
vi.mock('next/server', () => ({ connection: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/loaders.server', () => ({ carregarDashboardConsultor: mocks.dashboard, carregarRelatorioConsultor: mocks.relatorio }))
vi.mock('@/components/analytics/RelatorioControls', () => ({ RelatorioFilters: () => null, RelatorioPagination: () => null }))

import Dashboard from '@/app/consultor/dashboard/page'
import Relatorio from '@/app/consultor/relatorios/page'
import { parseRelatorioFiltros } from './contracts'

function dados(habilitada: boolean) {
  const dashboard: ConsultorDashboardData = {
    comissaoHabilitada: habilitada, cedentesTotal: 1, cedentesAtivos: 1, opsAtivas: 1, volumeAtivo: 10000, volumeMes: 10000,
    // Deliberately present even OFF to test fail-closed rendering independently of the SQL projection.
    comissaoEstimada: 900, operacoesRecentes: [],
    carteiraRecente: [{ cedenteId: 'a', razaoSocial: 'Cedente QA', cnpj: '98100000000168', status: 'ativo', comissaoPercentual: 10 }],
  }
  const relatorio: ConsultorRelatorioData = {
    filtros: parseRelatorioFiltros({ mes: '2026-09' }),
    resumo: { comissaoHabilitada: habilitada, volumeMes: 10000, operacoesMes: 1, comissaoMes: 900, volumeAcumulado: 10000, cedentesAtivos: 1, mesesDisponiveis: ['2026-09'] },
    tabela: buildPaginatedResult([{ cedenteId: 'a', razaoSocial: 'Cedente QA', cnpj: '98100000000168', status: 'ativo', percentual: 10, volumeMes: 9000, comissaoMes: 900, operacoesMes: 1, volumeTotal: 10000 }], { page: 1, pageSize: 10, total: 1 }),
  }
  mocks.dashboard.mockResolvedValue(dashboard)
  mocks.relatorio.mockResolvedValue(relatorio)
}

describe('GUIBOR A6 - DOM de comissão', () => {
  beforeEach(() => vi.clearAllMocks())
  it('OFF remove card, percentuais, títulos, colunas, totais e nota explicativa', async () => {
    dados(false)
    const dashboard = renderToStaticMarkup(await Dashboard())
    const relatorio = renderToStaticMarkup(await Relatorio({ searchParams: Promise.resolve({}) }))
    for (const html of [dashboard, relatorio]) {
      expect(html).not.toMatch(/comiss[aãõo]|10%/i)
      expect(html).toContain('sm:grid-cols-3')
    }
    expect(dashboard).toContain('Relatórios')
    expect(relatorio).toContain('>Relatórios</h1>')
    expect(relatorio).toContain('colSpan="4"')
  })
  it('ON preserva referências e comportamento atual', async () => {
    dados(true)
    const dashboard = renderToStaticMarkup(await Dashboard())
    const relatorio = renderToStaticMarkup(await Relatorio({ searchParams: Promise.resolve({}) }))
    expect(dashboard).toContain('Comissão estimada')
    expect(dashboard).toContain('10%')
    expect(relatorio).toContain('Comissão no mês')
    expect(relatorio).toContain('Comissões por cedente')
    expect(relatorio).toContain('Os valores finais são confirmados pelo gestor.')
  })
  it('linhas OFF em relatório misto não recebem percentual ou valor inventado', async () => {
    dados(true)
    const data = await mocks.relatorio()
    delete data.tabela.items[0].percentual
    delete data.tabela.items[0].comissaoMes
    const html = renderToStaticMarkup(await Relatorio({ searchParams: Promise.resolve({}) }))
    expect(html).not.toContain('10%')
    expect(html).toContain('>—</td>')
  })
})
