import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OperacaoCedenteDetalhe } from '@/lib/operacoes/cedente-detalhe'

const mocks = vi.hoisted(() => ({ carregar: vi.fn() }))
vi.mock('@/lib/operacoes/cedente-detalhe.server', () => ({ carregarDetalheOperacaoCedente: mocks.carregar }))
vi.mock('@/lib/auth/authorization', () => ({ AuthorizationError: class extends Error {} }))
vi.mock('@/components/operacoes/ExposicaoLogisticaOperacaoServer', () => ({ ExposicaoLogisticaOperacaoServer: () => null }))
vi.mock('@/components/historico/HistoricoTimelineCard', () => ({ HistoricoTimelineCard: () => createElement('section', { 'aria-label': 'Histórico' }, 'Histórico da operação') }))
vi.mock('@/components/contratos/BotaoDownloadArquivoOperacao', () => ({ BotaoDownloadArquivoOperacao: () => null }))
import OperacaoAcompanhamentoPage from './OperacaoAcompanhamentoPage'

function detalhe(perfil: 'consultor' | 'cedente'): OperacaoCedenteDetalhe {
  return {
    id: 'op-qa', codigoCurto: '281e07cc', status: 'solicitada', statusLabel: 'Solicitada', solicitadaEm: '2026-10-23T12:00:00Z',
    cedente: { razaoSocial: 'DISTRIBUIDORA DEMO QA — SEM VALOR FISCAL', cnpj: '98991022000165' },
    mensagemAceite: null, possuiPendenciaCedente: false,
    financeiro: { valorBrutoSolicitado: 30000, valorLiquidoAprovado: null, valorEfetivamenteDesembolsado: null, taxaAplicada: 2.5, prazoDias: 30, vencimento: '2026-11-23', aprovadoEm: null, desembolsadoEm: null, liquidadaEm: null },
    notasFiscais: Array.from({ length: 5 }, (_, index) => ({
      id: `nf-${index}`, numero: String(991001 + index), sacado: `Sacado de demonstração ${index + 1}`, cnpjSacado: '98200010000175',
      valorBruto: 6000, valorBrutoFiscal: 10000, valorAntecipado: null, vencimento: '2026-12-23', status: 'em_antecipacao', statusLabel: 'Em antecipação',
      href: `/${perfil}/notas-fiscais/nf-${index}${perfil === 'consultor' ? '?cedente=cedente-qa' : ''}`,
      totalParcelas: 3,
      parcelasCedidas: [1, 3].map(numero => ({ parcelaId: `p-${index}-${numero}`, numero, vencimentoOriginal: numero === 1 ? '2026-11-23' : '2026-12-23', valorNominal: 3000, prazoDias: null, valorAntecipado: null, desconto: null, statusFinanceiro: null })),
    })),
    fluxoFinanceiro: [],
    timeline: [{ id: 'solicitacao', ordem: 1, aplicavel: true, ator: 'Cedente', origem: 'fixture', titulo: 'Solicitação de antecipação enviada', descricao: 'O cedente enviou a solicitação de antecipação.', status: 'concluida', concluidaEm: '2026-10-23T12:00:00Z' }],
    pendenciasCedente: [],
    logistica: { habilitada: false, statusLabel: 'Sem acompanhamento', emTransito: 0, comPendencia: 0, concluidas: 0, prazoMaisProximo: null, diasPrazoMaisProximo: null, notas: [] },
    comprovantes: [],
  }
}

describe('página de acompanhamento no padrão visual de operações', () => {
  beforeEach(() => { mocks.carregar.mockReset() })

  for (const perfil of ['cedente', 'consultor'] as const) {
    it(`exibe tabela e resumo lateral para ${perfil}, mantendo somente leitura operacional`, async () => {
      mocks.carregar.mockResolvedValue(detalhe(perfil))
      const elemento = await OperacaoAcompanhamentoPage({ params: Promise.resolve({ id: 'op-qa' }), searchParams: Promise.resolve({ returnTo: `/${perfil}/operacoes?pagina=2` }), perfil })
      const html = renderToStaticMarkup(elemento)
      expect(mocks.carregar).toHaveBeenCalledWith('op-qa', { perfil })
      expect(html).toContain(`href="/${perfil}/operacoes?pagina=2"`)
      expect(html).toContain(`href="/${perfil}/notas-fiscais/nf-0`)
      expect(html).toContain('Parcelas a antecipar')
      expect(html).toContain('Resumo e acompanhamento da operação')
      expect(html).toContain('Histórico da operação')
      expect(html).toContain('Solicitação de antecipação enviada')
      expect(html.indexOf('<table')).toBeLessThan(html.indexOf('<aside'))
      expect(html.match(/<table/g)).toHaveLength(1)
      expect(html).not.toMatch(/Aprovar operação|Cancelar operação|Retirar parcela|Enviar remessa|Definir termos|Gerar Termo/)
      if (perfil === 'consultor') expect(html).toContain('somente leitura')

      // Optional, reproducible static visual fixture. No server, credentials or API calls.
      const output = process.env.CONSULTOR_UI_EVIDENCE_DIR
      if (output) {
        mkdirSync(output, { recursive: true })
        const cssDir = join(process.cwd(), '.next/static/css')
        const compiledCss = readdirSync(cssDir, { recursive: true }).filter((name): name is string => typeof name === 'string' && name.endsWith('.css')).map(name => readFileSync(join(cssDir, name), 'utf8')).join('\n')
        const fontClass = compiledCss.match(/\.([a-zA-Z0-9_]+)\{--font-inter:/)?.[1]
        expect(fontClass).toBeTruthy()
        const css = compiledCss.replace(/url\(\/_next\/static\/media\/([^)]*\.woff2)\)/g, (_, file: string) => `url(data:font/woff2;base64,${readFileSync(join(process.cwd(), '.next/static/media', file)).toString('base64')})`)
        const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        for (const theme of ['light', 'dark']) writeFileSync(join(output, `${perfil}-${theme}.html`), `<!doctype html><html lang="pt-BR" class="${fontClass} ${theme}"><head>${head}<title>Acompanhamento QA sintético</title><style>${css}</style></head><body class="font-sans"><main style="padding:24px;min-width:0">${html}</main></body></html>`)
      }
    })
  }

  it('não oferece resolver pendências ao Consultor, preservando o atalho do Cedente', async () => {
    for (const perfil of ['cedente', 'consultor'] as const) {
      const view = detalhe(perfil)
      view.pendenciasCedente = [{ id: 'pendencia-qa', descricao: 'Documento pendente', notaFiscalId: 'nf-0', notaFiscalNumero: '991001', prazo: null, situacaoPrazo: 'sem_prazo', dias: null, status: 'pendente', acaoHref: `/${perfil}/notas-fiscais/nf-0` }]
      mocks.carregar.mockResolvedValue(view)
      const html = renderToStaticMarkup(await OperacaoAcompanhamentoPage({ params: Promise.resolve({ id: 'op-qa' }), searchParams: Promise.resolve({}), perfil }))
      expect(html.includes('Resolver na NF')).toBe(perfil === 'cedente')
    }
  })
})
