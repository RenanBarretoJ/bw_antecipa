import { readFileSync } from 'node:fs'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatCurrency, formatDate } from '@/lib/utils'
import { buildOperacaoNotaFiscalView, OperacaoNotaFiscalCard } from './OperacaoNotaFiscalCard'
import { OperacaoParcelaCedidaRow, type ParcelaCedidaOperacao } from './OperacaoParcelaCedidaRow'

const parcelaPersistida: ParcelaCedidaOperacao = {
  parcelaId: 'parcela-1',
  numeroParcela: 1,
  dataVencimento: '2026-10-10',
  valorNominal: 10000,
  diasAplicados: 30,
  valorPresente: 9500,
  desconto: 500,
}

const notaFiscal = buildOperacaoNotaFiscalView({
  notaFiscal: {
    id: 'nf-1',
    numero_nf: '1741',
    cnpj_destinatario: '40439661000132',
    razao_social_destinatario: 'Sacado QA',
    valor_bruto: 10000,
    data_vencimento: '2026-10-10',
    status: 'em_antecipacao',
  },
  valorAntecipado: 9500,
  nowMs: new Date('2026-09-15T12:00:00Z').getTime(),
})

const detalheSource = readFileSync('src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx', 'utf8')

describe('P11.2.2 parcelas cedidas responsivas', () => {
  it('identifica semanticamente cada valor no mobile sem depender do cabeçalho', () => {
    const html = renderToStaticMarkup(createElement(OperacaoParcelaCedidaRow, { parcela: parcelaPersistida }))

    expect(html).toContain('<dl aria-label="Parcela 001"')
    expect(html).toContain('grid-cols-2')
    expect(html).toContain('md:grid-cols-[')
    for (const label of ['Parcela', 'Vencimento', 'Valor nominal', 'Prazo aplicado', 'Antecipado (VP)', 'Desconto']) {
      expect(html).toContain(`>${label}</dt>`)
    }
    expect(html).toContain(`>${formatDate(parcelaPersistida.dataVencimento)}</dd>`)
    expect(html).toContain(`>${formatCurrency(parcelaPersistida.valorNominal)}</dd>`)
    expect(html).toContain('>30 dias</dd>')
    expect(html).toContain(`>${formatCurrency(9500)}</dd>`)
    expect(html).toContain(`>${formatCurrency(500)}</dd>`)
  })

  it('mantém o cabeçalho no desktop e oculta visualmente os rótulos por linha', () => {
    const html = renderToStaticMarkup(createElement(OperacaoParcelaCedidaRow, { parcela: parcelaPersistida }))

    expect(detalheSource).toContain('aria-hidden="true" className="hidden grid-cols-[3.5rem_6rem_7rem_5rem_7rem_7rem]')
    expect(detalheSource).toContain('text-muted-foreground md:grid')
    expect(html.match(/md:sr-only/g)).toHaveLength(6)
    expect(html).toContain('md:grid-cols-[3.5rem_6rem_7rem_5rem_7rem_7rem]')
    expect(detalheSource).toContain('aria-expanded={expandido}')
    expect(detalheSource).toContain('aria-controls={`parcelas-${nf.id}`}')
    expect(detalheSource).toContain('focus-visible:ring-2 focus-visible:ring-ring')
  })

  it('mantém identificação e valores distintos quando há múltiplas parcelas', () => {
    const segunda: ParcelaCedidaOperacao = {
      ...parcelaPersistida,
      parcelaId: 'parcela-2',
      numeroParcela: 2,
      valorNominal: 8000,
      diasAplicados: 45,
      valorPresente: 7200,
      desconto: 800,
    }
    const html = renderToStaticMarkup(createElement(Fragment, null,
      createElement(OperacaoParcelaCedidaRow, { parcela: parcelaPersistida }),
      createElement(OperacaoParcelaCedidaRow, { parcela: segunda }),
    ))

    expect(html).toContain('aria-label="Parcela 001"')
    expect(html).toContain('aria-label="Parcela 002"')
    expect(html.match(/<dt /g)).toHaveLength(12)
    expect(html).toContain(`>${formatCurrency(10000)}</dd>`)
    expect(html).toContain(`>${formatCurrency(8000)}</dd>`)
    expect(html).toContain('>30 dias</dd>')
    expect(html).toContain('>45 dias</dd>')
  })

  it('exibe exatamente a memória recebida, sem recálculo, e mantém a query de origem', () => {
    const html = renderToStaticMarkup(createElement(OperacaoParcelaCedidaRow, { parcela: parcelaPersistida }))

    expect(html).toContain(`>${formatCurrency(9500)}</dd>`)
    expect(html).toContain(`>${formatCurrency(500)}</dd>`)
    expect(detalheSource).toContain(".from('operacao_calculo_nfs')")
    expect(detalheSource).toContain('valorPresente: memoria ? Number(memoria.valor_presente)')
    expect(detalheSource).toContain('desconto: memoria ? Number(memoria.desconto)')
  })

  it('renderiza os cards antes dos ramos de análise, desembolso e histórico', () => {
    const cardIndex = detalheSource.indexOf('...notasFiscaisView.map((nf) => {')
    const analyseIndex = detalheSource.indexOf('{canAnalyze && (', cardIndex)
    const disburseIndex = detalheSource.indexOf('{canDisburse && (', cardIndex)
    const historyIndex = detalheSource.indexOf('{!canAnalyze && !canDisburse && (', cardIndex)

    expect(cardIndex).toBeGreaterThan(-1)
    expect(analyseIndex).toBeGreaterThan(cardIndex)
    expect(disburseIndex).toBeGreaterThan(analyseIndex)
    expect(historyIndex).toBeGreaterThan(disburseIndex)
    expect(detalheSource).toContain("const canAnalyze = op.status === 'solicitada' || op.status === 'em_analise'")
    expect(detalheSource).toContain("const canDisburse = op.status === 'aprovada'")
  })

  it.each(['solicitada', 'em_analise', 'aprovada', 'em_andamento', 'liquidada', 'inadimplente', 'reprovada', 'cancelada'])(
    'mantém NF parcelada e memória compacta da NF legada no estado %s, sem bloco redundante',
    (status) => {
      const cardParcelado = renderToStaticMarkup(createElement(OperacaoNotaFiscalCard, {
        notaFiscal,
        statusNode: status,
        href: '/gestor/notas-fiscais/nf-1',
      }))
      const cardLegado = renderToStaticMarkup(createElement(OperacaoNotaFiscalCard, {
        notaFiscal,
        memoriaLegada: { dias_aplicados: 30, valor_nominal: 10000, desconto: 500, valor_presente: 9500 },
        statusNode: status,
        href: '/gestor/notas-fiscais/nf-1',
      }))
      const parcela = renderToStaticMarkup(createElement(OperacaoParcelaCedidaRow, { parcela: parcelaPersistida }))

      expect(cardParcelado).not.toContain('Memória congelada da NF')
      expect(cardParcelado).toContain('Ver NF')
      expect(parcela).toContain('Prazo aplicado')
      expect(cardLegado).toContain('Memória congelada da NF')
      expect(cardLegado).toContain(formatCurrency(9500))
      expect(detalheSource).not.toContain('Ver memoria de calculo por NF')
      expect(detalheSource).toContain('memoriaLegada={memoriaLegada}')
    },
  )
})
