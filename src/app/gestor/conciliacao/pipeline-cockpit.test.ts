import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { EtapaEsteiraFinanceira, StatusEsteiraFinanceira } from '@/lib/financeiro/conciliacao/pipeline-status.server'
import { PipelineCockpit } from './pipeline-cockpit'

const source = readFileSync(join(process.cwd(), 'src/app/gestor/conciliacao/pipeline-cockpit.tsx'), 'utf8')

function stage(overrides: Partial<EtapaEsteiraFinanceira> & Pick<EtapaEsteiraFinanceira, 'id' | 'titulo'>): EtapaEsteiraFinanceira {
  return {
    aplicavel: true,
    status: 'PRONTA',
    dataReferencia: overrides.id === 'bases' || overrides.id === 'exposicao' || overrides.id === 'risco' ? '2026-09-15' : '2026-09-14',
    ultimaExecucao: null,
    motivo: 'Etapa pronta para processamento.',
    acao: overrides.id === 'bases' ? null : { id: overrides.id, label: `Executar ${overrides.titulo}`, habilitada: true },
    ...overrides,
  }
}

function pipeline(): StatusEsteiraFinanceira {
  return {
    dataOperacional: '2026-09-15',
    dataD1: '2026-09-14',
    dataD2: '2026-09-11',
    fundoVirgem: false,
    proximaAcao: { etapaId: 'matching', mensagem: 'Próxima ação: executar vínculo Título × NF.' },
    etapas: [
      stage({ id: 'bases', titulo: 'Bases financeiras', status: 'EXECUTADA', motivo: 'Bases publicadas.' }),
      stage({ id: 'matching', titulo: 'Vínculo Título × NF' }),
      stage({ id: 'conciliacao', titulo: 'Conciliação Financeira', status: 'BLOQUEADA', motivo: 'Aquisições D-1 ainda não foram publicadas.', acao: { id: 'conciliacao', label: 'Executar conciliação', habilitada: false } }),
      stage({ id: 'logistica', titulo: 'Posição Logística' }),
      stage({ id: 'exposicao', titulo: 'Exposição em Trânsito' }),
      stage({ id: 'risco', titulo: 'Gate de Risco' }),
    ],
  }
}

describe('cockpit da esteira operacional', () => {
  it('renderiza todas as etapas, status, motivo, data-base e proxima acao', () => {
    const html = renderToStaticMarkup(createElement(PipelineCockpit, { pipeline: pipeline(), pending: false, onAction: vi.fn() }))
    for (const label of ['Bases financeiras', 'Vínculo Título × NF', 'Conciliação Financeira', 'Posição Logística', 'Exposição em Trânsito', 'Gate de Risco']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('Bloqueada')
    expect(html).toContain('Aquisições D-1 ainda não foram publicadas.')
    expect(html).toContain('Próxima ação: executar vínculo Título × NF.')
    expect(html).toContain('15/09/2026')
  })

  it('desabilita CTA bloqueado e preserva texto para leitor de tela', () => {
    const html = renderToStaticMarkup(createElement(PipelineCockpit, { pipeline: pipeline(), pending: false, onAction: vi.fn() }))
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="pipeline-stage-conciliacao-reason"/)
    expect(html).toContain('id="pipeline-stage-conciliacao-reason"')
  })

  it('mostra não aplicável textual sem CTA operacional', () => {
    const value = pipeline()
    value.etapas = value.etapas.map((item) => item.id === 'logistica'
      ? stage({ id: 'logistica', titulo: 'Posição Logística', aplicavel: false, status: 'NAO_APLICAVEL', motivo: 'A política não habilita acompanhamento.', acao: null })
      : item)
    const html = renderToStaticMarkup(createElement(PipelineCockpit, { pipeline: value, pending: false, onAction: vi.fn() }))
    expect(html).toContain('Não aplicável')
    expect(html).toContain('A política não habilita acompanhamento.')
    expect(html).not.toContain('Executar Posição Logística')
  })

  it('identifica histórico incompatível sem apresentá-lo como execução atual', () => {
    const value = pipeline()
    value.etapas = value.etapas.map((item) => item.id === 'matching'
      ? { ...item, ultimaExecucao: { dataReferencia: '2026-09-12', executadaEm: '2026-09-12T10:00:00Z', historica: true } }
      : item)
    const html = renderToStaticMarkup(createElement(PipelineCockpit, { pipeline: value, pending: false, onAction: vi.fn() }))
    expect(html).toContain('Histórico de 12/09/2026 — não usado na data atual')
  })

  it('possui grafo responsivo e semântica acessível sem depender apenas de cor', () => {
    expect(source).toContain('flex min-w-0 flex-col gap-2 xl:flex-row')
    expect(source).toContain('xl:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]')
    expect(source).toContain('aria-labelledby="pipeline-title"')
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('STATUS_LABELS[stage.status]')
    expect(source).toContain('aria-describedby={reasonId}')
  })

  it('explica que Conciliação é independente e que Risco recompõe a cadeia', () => {
    const html = renderToStaticMarkup(createElement(PipelineCockpit, { pipeline: pipeline(), pending: false, onAction: vi.fn() }))
    expect(html).toContain('A Conciliação Financeira é um ramo independente da cadeia logística.')
    expect(html).toContain('A Conciliação não é pré-requisito para calcular a Exposição em Trânsito.')
    expect(html).toContain('a cadeia canônica de Matching, Conciliação, Logística e Exposição é reprocessada')
  })
})
