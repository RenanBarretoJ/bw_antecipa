import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OperacaoAcompanhamentoTabela } from './OperacaoAcompanhamentoTabela'
import type { LinhaAcompanhamento } from '@/lib/operacoes/acompanhamento-tabela'
import { formatCurrency } from '@/lib/utils'

const linha: LinhaAcompanhamento = {
  id: 'nf-1:p-1', notaFiscalId: 'nf-1', numeroNf: '13197', parcelaId: 'p-1', numeroParcela: 1,
  sacado: 'Sacado QA', cnpjSacado: '98200010000175', brutoFiscal: 10000, baseCedida: 2500, antecipado: null,
  vencimento: '2026-11-01', statusNf: 'em_antecipacao', statusLabel: 'Em antecipação',
  href: '/consultor/notas-fiscais/nf-1?cedente=cedente-1', prazoDias: null, desconto: null,
  statusFinanceiro: null, parcelasCedidasNaNf: 2, totalParcelasNaNf: 3,
}

describe('interface da tabela de acompanhamento', () => {
  it('renderiza oito colunas, totais e link da NF no portal correto', () => {
    const html = renderToStaticMarkup(createElement(OperacaoAcompanhamentoTabela, { linhas: [linha] }))
    expect(html.match(/scope="col"/g)).toHaveLength(8)
    for (const label of ['Parcelas a antecipar', 'Bruto fiscal', 'Base cedida', 'Antecipado', 'Vencimento', 'Status da NF', 'Total filtrado', '2/3 cedidas']) expect(html).toContain(label)
    expect(html).toContain(linha.href)
    expect(html).not.toContain('/gestor/')
    expect(html).toContain(formatCurrency(10000))
    expect(html).toContain('aria-label="Buscar NF ou sacado"')
    expect(html).toContain('aria-label="Filtrar status da NF"')
    expect(html).toContain('role="status"')
  })

  it('não oferece nenhuma ação de escrita ou aprovação', () => {
    const html = renderToStaticMarkup(createElement(OperacaoAcompanhamentoTabela, { linhas: [linha] }))
    expect(html).not.toMatch(/Retirar|Excluir|Cancelar|Aprovar|Enviar|Anexar|type="submit"/)
    const source = readFileSync('src/components/operacoes/OperacaoAcompanhamentoTabela.tsx', 'utf8')
    expect(source).not.toMatch(/supabase|fetch\(|useEffect|lib\/actions|gestor\/|onRemover|onAprovar/)
  })

  it('limita renderização a 25 linhas e informa total e paginação', () => {
    const html = renderToStaticMarkup(createElement(OperacaoAcompanhamentoTabela, { linhas: Array.from({ length: 33 }, (_, index) => ({ ...linha, id: String(index), parcelaId: String(index) })) }))
    expect(html.match(/data-parcela-operacao=/g)).toHaveLength(25)
    expect(html).toContain('33 item(ns)')
    expect(html).toContain('Página 1 de 2')
    expect(html).toContain('aria-label="Paginação das parcelas"')
    expect(html).toContain('disabled=""')
  })

  it('preserva prazo e desconto da memória e identifica NF legada', () => {
    const html = renderToStaticMarkup(createElement(OperacaoAcompanhamentoTabela, { linhas: [{ ...linha, numeroParcela: null, totalParcelasNaNf: 0, antecipado: 2400, desconto: 100, prazoDias: 42, statusFinanceiro: 'Cronograma aprovado' }] }))
    expect(html).toContain('Prazo: 42 dias')
    expect(html).toContain(`Desconto: ${formatCurrency(100)}`)
    expect(html).toContain('Cronograma aprovado')
    expect(html).toContain('Parcela não cadastrada')
  })

  it('mantém rolagem dentro da tabela e estado vazio explícito', () => {
    const html = renderToStaticMarkup(createElement(OperacaoAcompanhamentoTabela, { linhas: [] }))
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('Nenhuma parcela cedida ou NF legada vinculada.')
    expect(html).not.toContain('<tfoot')
  })

  it('usa composição compartilhada apenas por Cedente/Consultor sem conectar a nova tabela ao Gestor', () => {
    const view = readFileSync('src/components/operacoes/OperacaoAcompanhamentoPage.tsx', 'utf8')
    expect(view).toContain('<OperacaoAcompanhamentoTabela linhas={linhas}')
    expect(view).toContain('xl:grid-cols-[minmax(0,1fr)_320px]')
    expect(view).toContain('<aside')
    expect(view).not.toMatch(/<Table|fluxoFinanceiro\.map|parcelasCedidas\.map/)
    const gestor = readFileSync('src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx', 'utf8')
    expect(gestor).toContain('<OperacaoParcelasTabela')
    expect(gestor).not.toContain('OperacaoAcompanhamento')
  })
})
