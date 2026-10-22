import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ConciliationNavigation, HiddenConciliationNavigation } from './conciliation-navigation'
import { estadoFilaConciliacao, totalFilaConciliacao, type PendingWorkqueuesData } from './pending-workqueues'
import { PendingWorkqueues } from './pending-workqueues-view'

const fixture = (): PendingWorkqueuesData => ({
  filtros: { tab: 'excecoes', dataReferencia: '2026-10-22' }, erros: {},
  matchingExecucao: { status: 'CONCLUIDA' }, conciliacaoExecucao: { status: 'CONCLUIDA' }, logisticaExecucao: null, riscoExecucao: null,
  matching: { total: 2538 }, conciliacao: { total: 0 }, logistica: { total: 0 },
})

describe('navegacao e filas operacionais', () => {
  it('prepara somente com dados sinteticos a prova visual dos componentes reais', () => {
    const output = process.env.CONCILIACAO_UI_EVIDENCE_DIR
    if (!output) return
    const root = resolve(process.env.LOCALAPPDATA || '/tmp', 'bw-antecipa-evidence')
    expect(resolve(output).startsWith(root)).toBe(true)
    mkdirSync(output, { recursive: true })
    const html = renderToStaticMarkup(createElement('main', { className: 'mx-auto max-w-7xl space-y-4 p-4' },
      createElement('h1', { className: 'text-2xl font-bold' }, 'Conciliação — fixture sintética'),
      createElement(ConciliationNavigation, { filters: { tab: 'logistica', dataReferencia: '2026-10-22' } }),
      createElement(PendingWorkqueues, { dashboard: fixture() })))
    writeFileSync(resolve(output, 'components.html'), `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`)
  })
  it('renderiza cinco links principais e duas visoes secundarias com estado ativo acessivel', () => {
    const html = renderToStaticMarkup(createElement(ConciliationNavigation, { filters: { tab: 'logistica', dataReferencia: '2026-10-22' } }))
    expect((html.match(/<a /g) || [])).toHaveLength(7)
    expect(html).toContain('aria-label="Seções da conciliação"')
    expect(html).toContain('aria-label="Visões de Lastro e Logística"')
    expect(html).toContain('detalhe=logistica')
    expect((html.match(/aria-current="page"/g) || [])).toHaveLength(2)
    for (const label of ['Resumo', 'Estoque e Movimentações', 'Lastro e Logística', 'Exposição e Risco', 'Pendências']) expect(html).toContain(label)
  })
  it('renderiza os parametros de grupo, detalhe e fila nos formularios sem perder o contexto', () => {
    const risk = renderToStaticMarkup(createElement(HiddenConciliationNavigation, { filters: { tab: 'risco', dataReferencia: '' } }))
    expect(risk).toContain('name="tab" value="exposicao-risco"')
    expect(risk).toContain('name="detalhe" value="risco"')
    const queue = renderToStaticMarkup(createElement(HiddenConciliationNavigation, { filters: { tab: 'excecoes', dataReferencia: '', fila: 'matching' } }))
    expect(queue).toContain('name="fila" value="matching"')
  })
  it('nao confunde execucao ausente, erro e base incompleta com ausencia de pendencias', () => {
    const data = fixture()
    expect(estadoFilaConciliacao(data, 'logistica')).toMatchObject({ verificada: false, quantidade: null })
    expect(estadoFilaConciliacao(data, 'conciliacao')).toMatchObject({ verificada: true, quantidade: 0 })
    data.erros.matching = 'Falha de consulta'
    expect(estadoFilaConciliacao(data, 'matching')).toMatchObject({ verificada: false, quantidade: null })
    data.conciliacaoExecucao = { status: 'BASE_INCOMPLETA' }
    expect(estadoFilaConciliacao(data, 'conciliacao').label).toBe('Bases incompletas')
  })
  it('pagina somente a fila selecionada, sem usar o maior total das outras filas', () => {
    const data = fixture()
    data.filtros.fila = 'conciliacao'
    expect(totalFilaConciliacao(data)).toBe(0)
    data.filtros.fila = 'matching'
    expect(totalFilaConciliacao(data)).toBe(2538)
    data.filtros.fila = undefined
    expect(totalFilaConciliacao(data)).toBe(0)
  })
  it('oferece tratamento e risco sem inventar uma soma global ou certificar filas nao executadas', () => {
    const html = renderToStaticMarkup(createElement(PendingWorkqueues, { dashboard: fixture() }))
    expect(html).toContain('2538 ocorrência(s)')
    expect(html).toContain('Ainda não verificada nesta data')
    expect(html).toContain('Ainda não avaliada nesta data')
    expect(html).toContain('Nenhuma ocorrência nesta fila')
    expect(html).toContain('não são somadas como títulos únicos')
    expect(html).toContain('Ver avaliação e revisões')
  })
  it('nao renderiza avaliacoes indisponiveis como aptas', () => {
    const data = fixture(); data.erros.risco = 'Erro'; data.riscoExecucao = { decisao: 'APTO', aplicavel: true }
    const html = renderToStaticMarkup(createElement(PendingWorkqueues, { dashboard: data }))
    expect(html).toContain('Não foi possível conferir a avaliação')
    expect(html).not.toContain('APTO')
  })
  it('preserva os guards de execucao e todas as interacoes documentais existentes', () => {
    const client = readFileSync(new URL('./conciliacao-financeira-client.tsx', import.meta.url), 'utf8')
    for (const action of ['confirmarMatchManualAction', 'revogarMatchManualAction', 'decidirRevisaoRiscoAction', 'simularExposicaoAction']) expect(client.includes(action)).toBe(true)
    expect(client.includes("if (!pipelineActions.get(action)?.habilitada) return")).toBe(true)
    expect(client.includes('Math.max(dashboard.matching.total')).toBe(false)
    expect(client.includes('totalFilaConciliacao(dashboard)')).toBe(true)
  })
})
