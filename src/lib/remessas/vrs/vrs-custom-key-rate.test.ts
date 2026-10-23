import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { agruparRemessa } from '../domain'
import { config, operacao } from './__fixtures__/operacao'
import { mapearGrupoParaVrs } from './mapper'
import { serializarVrsInclusaoCsv } from './csv'
import { gerarVrsInclusaoXlsx, VRS_LAYOUT_VERSION } from './xlsx'

const mapear = (op = operacao()) => mapearGrupoParaVrs(agruparRemessa([op], 'POR_CEDENTE')[0], config)

describe('VRS chave interna e taxa contratada', () => {
  it('repete NF/parcela_CNPJcedente no customizado 3 do ATIVO e FLUXO, sem mudar as chaves oficiais', () => {
    const op = operacao()
    op.notas[0].numero = '0003518'
    const original = structuredClone(op)
    const mapped = mapear(op)
    mapped.ativos.forEach((ativo, i) => {
      const parcela = op.notas[0].parcelasSelecionadas[i].numero
      expect(ativo.campos[1]).toBe(`0003518/${parcela}`)
      expect(ativo.campos[38]).toBe(`0003518/${parcela}_12345678000195`)
      expect(mapped.fluxos[i].campos[12]).toBe(ativo.campos[38])
      expect(mapped.fluxos[i].campos[2]).toBe(`0003518/${parcela}-1`)
      expect(ativo.campos.slice(39)).toEqual(['', ''])
      expect(mapped.fluxos[i].campos.slice(13)).toEqual(['', ''])
    })
    expect(op).toEqual(original)
  })

  it('usa o CNPJ do cedente normalizado, nao o da filial emissora ou do favorecido', () => {
    const op = operacao('cedente-a', '07.312.248/0001-37')
    op.notas[0].emissor.cnpj = '12345678000276'
    op.notas[0].emissor.contasBancarias[0].titular!.cpfCnpj = '12345678000195'
    const mapped = mapear(op)
    expect(mapped.ativos[0].campos[38]).toBe('100/2_07312248000137')
    expect(mapped.fluxos[0].campos[12]).toBe('100/2_07312248000137')
  })

  it('distingue a mesma NF/parcela entre cedentes', () => {
    const a = mapear(operacao('a', '07312248000137'))
    const b = mapear(operacao('b', '12345678000195'))
    expect(a.ativos[0].campos[1]).toBe(b.ativos[0].campos[1])
    expect(a.ativos[0].campos[38]).not.toBe(b.ativos[0].campos[38])
  })

  it.each<[number, string]>([[2.5, '2,5'], [2, '2'], [0, '0'], [3.99, '3,99'], [2.56789, '2,56789'], [0.0000001, '0,0000001']])(
    'envia a taxa %s como %s, sem percentual, divisao por 100 ou arredondamento monetario', (taxa, expected) => {
      const op = operacao()
      op.notas[0].parcelasSelecionadas.forEach(p => { p.taxaMensal = taxa })
      const original = structuredClone(op)
      const mapped = mapear(op)
      expect(mapped.ativos.map(a => a.campos[30])).toEqual([expected, expected, expected])
      expect(mapped.fluxos.every(f => f.campos[8] === '')).toBe(true)
      expect(mapped.pagamento[7]).toBe('2780,00')
      expect(op).toEqual(original)
    },
  )

  it.each([null, NaN, Infinity, -Infinity, -1])('bloqueia taxa ausente/invalida %s sem inventar zero', taxa => {
    const op = operacao()
    op.notas[0].parcelasSelecionadas[0].taxaMensal = taxa
    expect(() => mapear(op)).toThrow(/taxa.*memoria financeira/i)
  })

  it('preserva a taxa de cada memoria e as posicoes AD/AL no ATIVO e L no FLUXO, em CSV e XLSX', async () => {
    const op = operacao()
    op.notas[0].parcelasSelecionadas.forEach((p, i) => { p.taxaMensal = [2.5, 3.99, 0][i] })
    const mapped = mapear(op)
    const rows = serializarVrsInclusaoCsv(mapped).conteudo.toString('utf8').replace(/^\uFEFF/, '').trim().split('\r\n').map(r => r.split(';'))
    const ativos = rows.filter(r => r[0] === 'ATIVO'), fluxos = rows.filter(r => r[0] === 'FLUXO')
    expect(ativos.map(r => r[30])).toEqual(['2,5', '3,99', '0'])
    expect(ativos.every(r => r.length === 41)).toBe(true)
    expect(fluxos.every(r => r.length === 15)).toBe(true)
    const zip = await JSZip.loadAsync(await gerarVrsInclusaoXlsx(mapped))
    const ativoXml = await zip.file('xl/worksheets/sheet2.xml')!.async('text')
    const fluxoXml = await zip.file('xl/worksheets/sheet3.xml')!.async('text')
    ativos.forEach((a, i) => {
      const row = i + 2
      expect(ativoXml).toContain(`<c r="AD${row}" t="inlineStr"><is><t>${a[30]}</t>`)
      expect(ativoXml).toContain(`<c r="AL${row}" t="inlineStr"><is><t>${a[38]}</t>`)
      expect(fluxos[i][12]).toBe(a[38])
      expect(fluxoXml).toContain(`<c r="L${row}" t="inlineStr"><is><t>${a[38]}</t>`)
    })
  })

  it('versiona o novo conteudo para nao reutilizar arquivos V4 sem taxa/customizado 3', () => {
    expect(VRS_LAYOUT_VERSION).toBe('inclusao_v5_chave_interna_taxa')
  })
})
