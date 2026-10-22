import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VortxCotasEsperadas, VortxCotasEsperadasResumo } from './vortx-cotas-esperadas'

const configuracao = { codigo_carteira: 'QA-VRS', carteira_consolidada: { versao: 1, cotas: [
  { codigoCarteira: '00123', rotulo: 'QA Sênior' }, { codigoCarteira: '00124', rotulo: 'QA Mezanino' }, { codigoCarteira: '00125', rotulo: 'QA Subordinada' },
] } }
const render = (config: Record<string, unknown>, pending = false) => renderToStaticMarkup(createElement(VortxCotasEsperadas, { configuracao: config, pending }))
const decode = (value: string) => value.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

describe('editor de cotas esperadas Vortx', () => {
  it('explica configuracao pendente sem inventar a lista do RLX', () => {
    const html = render({})
    expect(html).toContain('Sem essa lista, a consolidação do PL permanece bloqueada')
    expect(html).toContain('value="null"')
    expect(html).not.toMatch(/20670|20671|20672|RLX/)
    expect(html).not.toContain('Adicionar cota')
  })

  it('reabre lista salva com labels associados, campos obrigatorios e payload separado do VRS', () => {
    const html = render(configuracao)
    expect(html).toContain('Adicionar cota')
    for (const codigo of ['00123', '00124', '00125']) expect(html).toContain(`value="${codigo}"`)
    expect(html.match(/<input[^>]+required/g)).toHaveLength(6)
    const ids = [...html.matchAll(/<input[^>]+id="([^"]+)"/g)].map(match => match[1])
    for (const id of ids) expect(html).toContain(`for="${id}"`)
    for (const index of [1, 2, 3]) expect(html).toContain(`aria-label="Remover cota ${index}"`)
    const raw = /name="carteiraConsolidada"[^>]+value="([^"]+)"/.exec(html)?.[1]
    expect(JSON.parse(decode(raw!))).toEqual(configuracao.carteira_consolidada)
    expect(raw).not.toContain('QA-VRS')
    expect(html).toContain('ainda não habilita a importação da carteira')
    expect(html).not.toMatch(/<form|Gerar relatório|Publicar agora/)
  })

  it('configuracao invalida fica visivel e exige correcao explicita, sem limpa-la como null', () => {
    const html = render({ carteira_consolidada: null })
    expect(html).toContain('role="alert"')
    expect(html).toContain('não será apagada ou substituída automaticamente')
    expect(html).toContain('Corrigir lista de cotas')
    expect(html).toContain('value="{}"')
    expect(html).not.toContain('value="null"')
  })

  it('bloqueia edicao enquanto a acao estiver em andamento', () => {
    expect(render(configuracao, true)).toMatch(/<fieldset[^>]+disabled=""/)
  })

  it('resumo renderiza somente a lista daquela versao e escapa labels externos', () => {
    const html = renderToStaticMarkup(createElement(VortxCotasEsperadasResumo, { configuracao }))
    expect(html).toContain('Cotas esperadas · 3')
    expect(html).toContain('QA Subordinada')
    expect(html).toContain('00125')
    expect(html).not.toContain('type="text"')
    const outra = { carteira_consolidada: { versao: 1, cotas: [{ codigoCarteira: 'OUTRA', rotulo: '<script>teste</script>' }] } }
    const segundo = renderToStaticMarkup(createElement(VortxCotasEsperadasResumo, { configuracao: outra }))
    expect(segundo).not.toContain('00125')
    expect(segundo).toContain('&lt;script&gt;')
    expect(segundo).not.toContain('<script>')
  })

  it('diferencia lista ausente de lista invalida no historico', () => {
    expect(renderToStaticMarkup(createElement(VortxCotasEsperadasResumo, { configuracao: {} }))).toContain('não configuradas')
    expect(renderToStaticMarkup(createElement(VortxCotasEsperadasResumo, { configuracao: { carteira_consolidada: {} } }))).toContain('requer revisão')
  })
})
