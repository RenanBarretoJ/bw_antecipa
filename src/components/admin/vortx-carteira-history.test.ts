import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { VortxCarteiraHistory } from './vortx-carteira-history'
import { ResumoBases } from './central-bases-history'
import type { HistoricoCarteira, RegistroCarteira } from '@/lib/integracoes/vortx/carteira-historico'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
const row: RegistroCarteira = { id: 'synthetic', estado: 'PUBLICADA', dataReferencia: '2026-10-21', patrimonioLiquidoTotal: '60.0000',
  recebidaEm: '2026-10-22T14:06:59Z', publicadaEm: '2026-10-22T14:06:59Z', substituidaEm: null,
  cotas: [{ codigoCarteira: 'QA', rotulo: 'Cota QA', patrimonioLiquido: '60.0000' }] }
const historico: HistoricoCarteira = { registros: [row], total: 25, pagina: 1, filtros: {} }
describe('histórico visual e resumo da carteira', () => {
  it('apresenta posição, horários de Brasília, PL e detalhamento sem falsificar callback ou cron', () => {
    const html = renderToStaticMarkup(createElement(VortxCarteiraHistory, { historico, href: '/gestor/central-bases' }))
    expect(html).toContain('21/10/2026'); expect(html).toContain('11:06:59'); expect(html).toContain('60,00'); expect(html).toContain('Conferir 1 cotas')
    expect(html).toContain('Cota QA'); expect(html).toContain('API Carteira · JSON'); expect(html).toContain('carteiraPagina=2#historico-carteira')
    expect(html).not.toMatch(/Protocolo Vórtx|Rotina diária|token=|storage_path/)
  })
  it('mantém versões substituídas identificadas sem ação de reativação', () => {
    const html = renderToStaticMarkup(createElement(VortxCarteiraHistory, { historico: { ...historico, registros: [{ ...row, estado: 'RETIFICADA', substituidaEm: row.publicadaEm }] }, href: '' }))
    expect(html).toContain('Retificada · substituída'); expect(html).toContain('Substituída:')
    expect(html).toContain('uma versão retificada não é reativada')
  })
  it('mantém a publicação do resumo independente do histórico filtrado e mostra PL verdadeiro', () => {
    const html = renderToStaticMarkup(createElement(ResumoBases, { resumo: [], posicaoCarteira: row }))
    expect(html).toContain('21/10/2026'); expect(html).toContain('Publicada'); expect(html).toContain('60,00')
    expect(html).not.toContain('Persistência ainda não habilitada'); expect(html).not.toContain('Não processada')
  })
  it('não inventa posição ou zero na ausência de carteira', () => {
    const html = renderToStaticMarkup(createElement(ResumoBases, { resumo: [], posicaoCarteira: null }))
    expect(html).toContain('Sem posição publicada'); expect(html).not.toContain('R$')
  })
  it('mostra vazio filtrado e preserva aba administrativa nos links', () => {
    const html = renderToStaticMarkup(createElement(VortxCarteiraHistory, { historico: { ...historico, registros: [], filtros: { estado: 'RETIFICADA' } }, href: '/admin/fundos/qa?tab=central-bases&tipo=Inclusao' }))
    expect(html).toContain('Nenhuma posição salva corresponde aos filtros'); expect(html).toContain('tab=central-bases&amp;tipo=Inclusao&amp;carteiraEstado=RETIFICADA&amp;carteiraPagina=2#historico-carteira')
    expect(html).toContain('Consultas sem persistência não constam nesta lista')
  })
})
