import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BaseFinanceiraDaData, BaseFinanceiraResolvida } from '@/lib/financeiro/conciliacao/base-financeira'
import { CONCILIACAO_SUBTABS, resumirBaseFinanceira } from './central-ux'

const client = readFileSync(join(process.cwd(), 'src/app/gestor/conciliacao/conciliacao-financeira-client.tsx'), 'utf8')

const baseItem = (estado: BaseFinanceiraResolvida['estado']): BaseFinanceiraResolvida => ({
  tipo: 'ESTOQUE',
  dataEsperada: '2026-09-14',
  dataReferencia: estado === 'INDISPONIVEL' ? null : '2026-09-14',
  defasagem: null,
  estado,
  valor: estado === 'VALOR' ? '100.00' : null,
  importacaoId: estado === 'INDISPONIVEL' ? null : 'importacao-id',
  origem: estado === 'INDISPONIVEL' ? null : 'PORTAL_FIDC',
  provedor: estado === 'INDISPONIVEL' ? null : 'sinqia',
  origemQa: false,
})

const baseCompleta = (): BaseFinanceiraDaData => ({
  dataOperacional: '2026-09-15',
  dataD1: '2026-09-14',
  dataD2: '2026-09-11',
  estoqueD2: baseItem('VALOR'),
  estoque: baseItem('VALOR'),
  aquisicoes: baseItem('ZERO'),
  liquidacoes: baseItem('ZERO'),
  carteira: { ...baseItem('VALOR'), tipo: 'CARTEIRA' },
  statusGeral: 'PRONTA',
})

describe('quick wins de UX da Central de Conciliação', () => {
  it('mantém ids internos e apresenta a nova nomenclatura das subtabs', () => {
    expect(CONCILIACAO_SUBTABS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'visao-geral', label: 'Visão geral' },
      { id: 'matching', label: 'Vínculo Título × NF' },
      { id: 'conciliacao', label: 'Conciliação Financeira' },
      { id: 'logistica', label: 'Posição Logística' },
      { id: 'exposicao', label: 'Exposição em Trânsito' },
      { id: 'risco', label: 'Gate de Risco' },
      { id: 'excecoes', label: 'Exceções Operacionais' },
    ])
  })

  it('explica a fórmula e o caráter operacional da conciliação', () => {
    const tab = CONCILIACAO_SUBTABS.find((item) => item.id === 'conciliacao')
    expect(tab?.formula).toBe('Estoque D-2 + Aquisições D-1 - Liquidações D-1 ≈ Estoque D-1')
    expect(tab?.detail).toContain('não representa o saldo contábil definitivo')
  })

  it('fornece contexto para todas as subtabs e delimita as exceções atuais', () => {
    expect(CONCILIACAO_SUBTABS.every((item) => item.description.length > 0)).toBe(true)
    expect(CONCILIACAO_SUBTABS.find((item) => item.id === 'logistica')?.description).toContain('evidências logísticas aprovadas')
    expect(CONCILIACAO_SUBTABS.find((item) => item.id === 'excecoes')?.detail).toContain('Gate de Risco possui tratamento próprio')
  })

  it('resume uma base completa sem inferir dados', () => {
    expect(resumirBaseFinanceira(baseCompleta())).toEqual({
      tone: 'success',
      message: 'Base financeira disponível para a data operacional selecionada.',
    })
  })

  it('lista as bases ausentes que bloqueiam a conciliação', () => {
    const base = baseCompleta()
    base.estoqueD2 = baseItem('INDISPONIVEL')
    base.aquisicoes = baseItem('INDISPONIVEL')
    expect(resumirBaseFinanceira(base)).toEqual({
      tone: 'warning',
      message: 'Conciliação Financeira bloqueada: Estoque D-2 e Aquisições D-1 ainda não estão disponíveis.',
    })
  })

  it('distingue base publicada sem movimento de ausência', () => {
    const base = baseCompleta()
    base.estoqueD2 = baseItem('SEM_MOVIMENTO')
    base.estoque = baseItem('SEM_MOVIMENTO')
    base.aquisicoes = baseItem('SEM_MOVIMENTO')
    base.liquidacoes = baseItem('SEM_MOVIMENTO')
    expect(resumirBaseFinanceira(base)).toEqual({
      tone: 'default',
      message: 'A base foi publicada sem movimento para a data de referência.',
    })
  })

  it('distingue PL ausente de indisponibilidade da conciliação', () => {
    const base = baseCompleta()
    base.carteira = { ...baseItem('INDISPONIVEL'), tipo: 'CARTEIRA' }
    expect(resumirBaseFinanceira(base).message).toContain('Bases de conciliação disponíveis')
    expect(resumirBaseFinanceira(base).message).toContain('PL de referência ainda não está disponível')
  })

  it('exibe Estoque D-2 no card sem remover as demais bases', () => {
    expect(client).toContain("['Estoque D-2', base.estoqueD2")
    expect(client).toContain("['Estoque D-1', base.estoque")
    expect(client).toContain("['Aquisições D-1', base.aquisicoes")
    expect(client).toContain("['Liquidações D-1', base.liquidacoes")
    expect(client).toContain("['PL de referência', base.carteira")
  })

  it('explica a atualização de risco sem alterar a action', () => {
    expect(client).toContain('aria-describedby="risk-action-help"')
    expect(client).toContain('Reprocessa Matching, Conciliação, Logística e Exposição antes de recalcular o Gate de Risco.')
    expect(client).toContain('executarGateRiscoAction({ dataReferencia: dashboard.filtros.dataReferencia })')
  })

  it('destaca os três indicadores canônicos de exposição', () => {
    expect(client).toContain("['Valor em trânsito', money(execution?.exposicao_em_transito_total)]")
    expect(client).toContain("['PL de referência', money(execution?.patrimonio_liquido_d2)]")
    expect(client).toContain("['Exposição', percentValue(execution?.percentual_exposicao)]")
  })

  it('prioriza exposição, limite e resultado no Gate de Risco', () => {
    expect(client).toContain('<SummaryCard label="Exposição atual"')
    expect(client).toContain('<SummaryCard label="Limite"')
    expect(client).toContain('<SummaryCard label="Resultado"')
  })

  it('mantém navegação e ações responsivas e acessíveis', () => {
    expect(client).toContain('grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 md:grid-cols-4 xl:grid-cols-7')
    expect(client).toContain("aria-current={dashboard.filtros.tab === tab.id ? 'page' : undefined}")
    expect(client).toContain('grid gap-2 sm:flex sm:flex-wrap sm:justify-end')
    expect(client).toContain('focus-visible:ring-2 focus-visible:ring-ring')
  })

  it('destaca somente pelo contexto visual a ação da subtab ativa', () => {
    for (const tab of ['matching', 'conciliacao', 'logistica', 'exposicao', 'risco']) {
      expect(client).toContain(`dashboard.filtros.tab === '${tab}' ? 'default' : 'outline'`)
    }
  })
})
