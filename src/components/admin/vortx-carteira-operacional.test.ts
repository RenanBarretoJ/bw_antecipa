import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/gestor/dados-financeiros/carteira-actions', () => ({ processarCarteiraVortxAction: vi.fn() }))
import { VortxCarteiraOperacional } from './vortx-carteira-operacional'
const base = { hoje: '2026-10-22', referenciaInicial: '2026-10-21', habilitada: true, podeProcessar: true, posicaoInicial: null }
describe('carteira operacional na Central de Bases', () => {
  it('explica D-1 util e horario separado do estoque, com submit explicito e status acessivel', () => {
    const html = renderToStaticMarkup(createElement(VortxCarteiraOperacional, base))
    expect(html).toContain('D−1 útil'); expect(html).toContain('17h de Brasília'); expect(html).toContain('9h30')
    expect(html).toContain('Consultar e publicar carteira completa'); expect(html).toContain('aria-live="polite"'); expect(html).not.toContain('D−2')
  })
  it('nao inventa PL nem classes para posicao ausente', () => {
    const html = renderToStaticMarkup(createElement(VortxCarteiraOperacional, base))
    expect(html).toContain('Sem posição'); expect(html).not.toContain('R$')
  })
  it('mostra dados canonicos e detalhamento de cotas', () => {
    const html = renderToStaticMarkup(createElement(VortxCarteiraOperacional, { ...base, posicaoInicial: { dataReferencia: '2026-10-20', patrimonioLiquidoTotal: '30.0000', cotas: [{ codigoCarteira: 'QA', rotulo: 'Subordinada', patrimonioLiquido: '30.0000' }] } }))
    expect(html).toContain('20/10/2026'); expect(html).toContain('Subordinada'); expect(html).toContain('Conferir o PL por cota')
  })
  it.each([{ habilitada: false }, { podeProcessar: false }, { capacidadePublicada: false }])('desabilita processamento sem escopo operacional %j', change => {
    const html = renderToStaticMarkup(createElement(VortxCarteiraOperacional, { ...base, ...change }))
    expect(html).toContain('<fieldset disabled=')
  })
  it('distingue capacidade ausente de falta de acesso do operador', () => {
    const html = renderToStaticMarkup(createElement(VortxCarteiraOperacional, { ...base, capacidadePublicada: false }))
    expect(html).toContain('Configuração pendente: publique a capacidade Carteira')
    expect(html).toContain('Nenhuma consulta à Vórtx foi enviada')
    expect(html).not.toContain('Seu acesso permite acompanhar')
  })
})
