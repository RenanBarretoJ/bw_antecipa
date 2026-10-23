import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import {
  agruparRemessa,
  chaveUnicaAtivo,
  chaveUnicaParcela,
  type RemessaOperacaoCanonica,
} from '@/lib/remessas/domain'
import { consolidarStatusSubremessas } from '@/lib/remessas/service.server'
import { chaveAtivoVrs, chaveParcelaVrs, identidadeDuplicataVrs } from './chaves'
import { mapearGrupoParaVrs, VrsMappingError } from './mapper'
import { serializarVrsInclusaoCsv } from './csv'
import { gerarDownloadExcelVrs, gerarVrsInclusaoXlsx, VRS_LAYOUT_VERSION } from './xlsx'

import { config, contaEstruturada, operacao } from './__fixtures__/operacao'
import { classificarStatusLogisticoPreCessao } from '@/lib/logistica/evidencias-logisticas'

describe('P4 - adapter Vortx VRS por Cedente', () => {
  it.each([undefined, '', 'INVALIDO', '68522785000104'])('usa o emitente da NF para originador e emissor, ignorando configuracao legada %s', cnpjOriginador => {
    const op = operacao()
    const configuracao = { ...config, vrs_inclusao: { ...config.vrs_inclusao, cnpj_originador: cnpjOriginador } }
    const mapped = mapearGrupoParaVrs(agruparRemessa([op], 'POR_CEDENTE')[0], configuracao)
    const rows = serializarVrsInclusaoCsv(mapped).conteudo.toString('utf8').split('\r\n').map(row => row.split(';'))
    for (const row of rows.filter(row => row[0] === 'ATIVO')) expect(row.slice(2, 4)).toEqual(['12345678000195', '12345678000195'])
    for (const row of rows.filter(row => row[0] === 'FLUXO')) expect(row[3]).toBe('12345678000195')
  })

  it.each(['', '123', 'INVALIDO'])('nao substitui emitente invalido %s pelo originador configurado', cnpj => {
    const op = operacao()
    op.notas[0].emissor.cnpj = cnpj
    expect(() => mapearGrupoParaVrs(agruparRemessa([op], 'POR_CEDENTE')[0], config)).toThrow(/estabelecimento emissor sem CNPJ valido/)
  })

  it('CSV e XLSX usam o CNPJ normalizado do emitente da NF, nao o da configuracao', async () => {
    const op = operacao()
    op.notas[0].emissor.cnpj = '12.345.678/0002-76'
    const mapped = mapearGrupoParaVrs(agruparRemessa([op], 'POR_CEDENTE')[0], config)
    for (const ativo of mapped.ativos) expect(ativo.campos.slice(2, 4)).toEqual(['12345678000276', '12345678000276'])
    const zip = await JSZip.loadAsync(await gerarVrsInclusaoXlsx(mapped))
    const sheet = await zip.file('xl/worksheets/sheet2.xml')!.async('text')
    expect(sheet).toContain('<c r="B2" t="inlineStr"><is><t>12345678000276</t>')
    expect(sheet).toContain('<c r="C2" t="inlineStr"><is><t>12345678000276</t>')
  })

  it('preenche as posicoes fisicas 37 e 38 sem deslocar o restante do CSV', () => {
    const op = operacao()
    op.notas[0].numero = '000100'
    const mapped = mapearGrupoParaVrs(agruparRemessa([op], 'POR_CEDENTE')[0], config)
    const ativo = serializarVrsInclusaoCsv(mapped).conteudo.toString('utf8').split('\r\n')[1].split(';')
    expect(ativo).toHaveLength(41)
    expect(ativo.slice(35)).toEqual(['CERC', op.notas[0].chaveAcesso, 'em transito', '000100/2_12345678000195', '', ''])
  })

  it.each([null, '', '123', 'x'.repeat(44)])('bloqueia chave de NF ausente ou invalida: %s', chave => {
    const op = operacao()
    op.notas[0].chaveAcesso = chave
    expect(() => mapearGrupoParaVrs(agruparRemessa([op], 'POR_CEDENTE')[0], config)).toThrow(/44 digitos/)
  })

  it('gera as quatro abas e todos os cabecalhos na ordem do XLSX de referencia', async () => {
    const op = operacao()
    const mapped = mapearGrupoParaVrs(agruparRemessa([op], 'POR_CEDENTE')[0], config)
    const zip = await JSZip.loadAsync(await gerarVrsInclusaoXlsx(mapped))
    const golden = await JSZip.loadAsync(readFileSync('src/lib/remessas/vrs/__fixtures__/inclusao_modelo.xlsx'))
    const workbook = await zip.file('xl/workbook.xml')!.async('text')
    expect([...workbook.matchAll(/<sheet name="([^"]+)"/g)].map(match => match[1])).toEqual(['HEADER', 'ATIVO', 'FLUXO', 'PAGAMENTO'])
    for (let i = 1; i <= 4; i++) {
      const path = `xl/worksheets/sheet${i}.xml`
      const sheet = await zip.file(path)!.async('text')
      const reference = await golden.file(path)!.async('text')
      const header = (value: string) => [...value.match(/<row\b[^>]*r="1"[^>]*>([\s\S]*?)<\/row>/)![1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map(match => match[1])
      expect(header(sheet)).toEqual(header(reference))
    }
    const ativo = await zip.file('xl/worksheets/sheet2.xml')!.async('text')
    expect(ativo).toContain(`<c r="AJ2" t="inlineStr"><is><t>${op.notas[0].chaveAcesso}</t>`)
    expect(ativo).toContain('<c r="AK2" t="inlineStr"><is><t>em transito</t>')
    expect(ativo).toContain('<c r="F2" t="inlineStr"><is><t>01310100</t>')
    const fluxo = await zip.file('xl/worksheets/sheet3.xml')!.async('text')
    expect(fluxo).toContain(`<c r="J2" t="inlineStr"><is><t>${op.notas[0].chaveAcesso}</t>`)
    expect(fluxo).toContain('<c r="K2" t="inlineStr"><is><t>em transito</t>')
    expect([...fluxo.matchAll(/<row /g)]).toHaveLength(4)
    expect(fluxo).not.toContain('parcela-1-')
    expect(await zip.file('xl/worksheets/sheet4.xml')!.async('text')).toContain('2780,00')
    const download = await gerarDownloadExcelVrs([mapped])
    expect(download.nome).toBe('12345678000195.xlsx')
    expect(download.contentType).toContain('spreadsheetml')
  })

  it('mantem um workbook por Cedente no download de lotes com varios Cedentes', async () => {
    const groups = agruparRemessa([operacao('a', '11111111000111'), operacao('b', '22222222000122')], 'POR_CEDENTE')
    const download = await gerarDownloadExcelVrs(groups.map(grupo => mapearGrupoParaVrs(grupo, config)))
    expect(download.contentType).toBe('application/zip')
    const zip = await JSZip.loadAsync(download.conteudo)
    expect(Object.keys(zip.files)).toEqual(['11111111000111.xlsx', '22222222000122.xlsx'])
    const first = await JSZip.loadAsync(await zip.file('11111111000111.xlsx')!.async('nodebuffer'))
    const header = await first.file('xl/worksheets/sheet1.xml')!.async('text')
    expect(header).toContain('11111111000111')
    expect(header).not.toContain('22222222000122')
  })

  it('cenario A V4: gera tres duplicatas e somente os tres FLUXOS selecionados', () => {
    const grupo = agruparRemessa([operacao()], 'POR_CEDENTE')[0]
    const mapped = mapearGrupoParaVrs(grupo, config)
    const csv = serializarVrsInclusaoCsv(mapped)
    const linhas = csv.conteudo.toString('utf8').replace(/^\uFEFF/, '').trim().split('\r\n')

    expect(linhas.map((linha) => linha.split(';')[0])).toEqual(['HEADER', 'ATIVO', 'ATIVO', 'ATIVO', 'FLUXO', 'FLUXO', 'FLUXO', 'PAGAMENTO'])
    expect(linhas[0].split(';')).toHaveLength(6)
    expect(linhas.slice(1, 4).every((linha) => linha.split(';').length === 41)).toBe(true)
    expect(linhas.slice(4, 7).every((linha) => linha.split(';').length === 15)).toBe(true)
    expect(linhas.at(-1)?.split(';')).toHaveLength(8)
    expect(mapped.pagamento).toEqual([
      'PAGAMENTO', '001', '1234', '100', '7', '12345678000195', 'Cedente cedente-a', '2780,00',
    ])
    expect(csv.conteudo.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(csv.conteudo.toString('utf8')).toContain('\r\n')
    expect(mapped.fluxos.map((item) => item.parcelaId)).toEqual(['parcela-2-cedente-a', 'parcela-3-cedente-a', 'parcela-5-cedente-a'])
  })

  it('cenario B: VRS particiona tres Cedentes em exatamente tres grupos sem mistura', () => {
    const operacoes = [
      operacao('cedente-a', '11111111000111'),
      operacao('cedente-b', '22222222000122'),
      operacao('cedente-c', '33333333000133'),
    ]
    const grupos = agruparRemessa(operacoes, 'POR_CEDENTE')
    expect(grupos).toHaveLength(3)
    expect(grupos.every((grupo) => new Set(grupo.operacoes.map((item) => item.cedente.id)).size === 1)).toBe(true)
    expect(grupos.map((grupo) => mapearGrupoParaVrs(grupo, config).cedenteCnpj)).toEqual([
      '11111111000111', '22222222000122', '33333333000133',
    ])
  })

  it('cenario C: POR_LOTE preserva um unico grupo e nao herda a regra da Vortx', () => {
    expect(agruparRemessa([operacao('a'), operacao('b'), operacao('c')], 'POR_LOTE')).toHaveLength(1)
  })

  it('cenario D: consolida sucesso parcial sem mascarar estados individuais', () => {
    expect(consolidarStatusSubremessas(['enviada', 'erro', 'enviada'])).toBe('parcial')
    expect(consolidarStatusSubremessas(['enviada', 'enviada'])).toBe('enviada')
    expect(consolidarStatusSubremessas(['erro', 'erro'])).toBe('erro')
  })

  it('cenario F: chaves ATIVO e FLUXO sao deterministicas entre reprocessamentos', () => {
    expect(chaveUnicaAtivo('nf-123')).toBe(chaveUnicaAtivo('nf-123'))
    expect(chaveUnicaParcela('parcela-456')).toBe(chaveUnicaParcela('parcela-456'))
    expect(chaveUnicaAtivo('nf-123')).not.toBe(chaveUnicaAtivo('nf-999'))
  })

  it('falha fechada e detalhada quando campo oficial obrigatorio esta ausente', () => {
    const incompleta = operacao()
    incompleta.notas[0].devedor.cep = null
    expect(() => mapearGrupoParaVrs(agruparRemessa([incompleta], 'POR_CEDENTE')[0], config))
      .toThrow(VrsMappingError)
    expect(() => mapearGrupoParaVrs(agruparRemessa([incompleta], 'POR_CEDENTE')[0], config))
      .toThrow(/CEP do devedor/)
  })

  it('nao permite misturar dois Cedentes no mesmo CSV VRS', () => {
    expect(() => mapearGrupoParaVrs({ chave: 'invalido', cedenteId: 'a', operacoes: [operacao('a'), operacao('b')] }, config))
      .toThrow(/nao pode misturar Cedentes/)
  })

  it('cenario P4.1 A: Matriz usa a conta principal ativa da propria Matriz', () => {
    const matriz = operacao()
    matriz.notas[0].emissor.estabelecimentoId = 'matriz-1'
    matriz.notas[0].emissor.contasBancarias = [contaEstruturada('matriz-1', { agencia: '4321', conta: '987-6' })]

    expect(mapearGrupoParaVrs(agruparRemessa([matriz], 'POR_CEDENTE')[0], config).pagamento.slice(1, 5))
      .toEqual(['001', '4321', '987', '6'])
  })

  it('cenario P4.1 B: Filial usa a conta principal ativa da propria Filial', () => {
    const filial = operacao()
    filial.notas[0].emissor = {
      estabelecimentoId: 'filial-1',
      cnpj: '12345678000276',
      nome: 'Cedente filial',
      contasBancarias: [contaEstruturada('filial-1', {
        bancoCodigo: '341',
        bancoIspb: '60701190',
        agencia: '5678',
        conta: '456-9',
        titular: {
          estabelecimentoId: 'filial-1',
          cedenteId: 'cedente-a',
          cpfCnpj: '12345678000276',
          nome: 'Cedente filial',
        },
      })],
    }

    const pagamento = mapearGrupoParaVrs(agruparRemessa([filial], 'POR_CEDENTE')[0], config).pagamento
    expect(pagamento.slice(1, 5)).toEqual(['341', '5678', '456', '9'])
    expect(pagamento.slice(5, 7)).toEqual(['12345678000276', 'Cedente filial'])
  })

  it('cenario P4.1 C: Matriz e Filial podem compartilhar o mesmo destino bancario', () => {
    const compartilhada = operacao()
    const primeira = compartilhada.notas[0]
    compartilhada.notas.push({
      ...primeira,
      id: '22222222-2222-3333-4444-555555555555',
      numero: '101',
      emissor: {
        estabelecimentoId: 'filial-mesma-conta',
        cnpj: '12345678000276',
        nome: 'Cedente filial',
        contasBancarias: [contaEstruturada('filial-mesma-conta', {
          titular: {
            estabelecimentoId: 'est-cedente-a',
            cedenteId: 'cedente-a',
            cpfCnpj: '12345678000195',
            nome: 'Cedente cedente-a',
          },
        })],
      },
      parcelasSelecionadas: primeira.parcelasSelecionadas.map((parcela) => ({
        ...parcela,
        id: `${parcela.id}-filial`,
      })),
    })

    const mapped = mapearGrupoParaVrs(agruparRemessa([compartilhada], 'POR_CEDENTE')[0], config)
    const pagamento = mapped.pagamento
    expect(pagamento.slice(1, 7)).toEqual(['001', '1234', '100', '7', '12345678000195', 'Cedente cedente-a'])
    expect(mapped.ativos.map(ativo => ativo.campos.slice(2, 4))).toEqual([
      ...primeira.parcelasSelecionadas.map(() => ['12345678000195', '12345678000195']),
      ...primeira.parcelasSelecionadas.map(() => ['12345678000276', '12345678000276']),
    ])
  })

  it('cenario P4.1 D: conta estruturada incompleta bloqueia a remessa', () => {
    const incompleta = operacao()
    incompleta.notas[0].emissor.contasBancarias[0].bancoCodigo = null

    expect(() => mapearGrupoParaVrs(agruparRemessa([incompleta], 'POR_CEDENTE')[0], config))
      .toThrow(/banco_codigo deve possuir exatamente 3 digitos COMPE/)
  })

  it('cenario P4.1 E: duas contas distintas no mesmo arquivo sao bloqueadas explicitamente', () => {
    const multipla = operacao()
    const primeira = multipla.notas[0]
    multipla.notas.push({
      ...primeira,
      id: '22222222-2222-3333-4444-555555555555',
      numero: '102',
      emissor: {
        estabelecimentoId: 'filial-outra-conta',
        cnpj: '12345678000276',
        nome: 'Cedente filial',
        contasBancarias: [contaEstruturada('filial-outra-conta', { agencia: '9999', conta: '888-1' })],
      },
      parcelasSelecionadas: primeira.parcelasSelecionadas.map((parcela) => ({
        ...parcela,
        id: `${parcela.id}-outra-conta`,
      })),
    })

    expect(() => mapearGrupoParaVrs(agruparRemessa([multipla], 'POR_CEDENTE')[0], config))
      .toThrow(/REMESSA_VRS_MULTIPLAS_CONTAS_NAO_SUPORTADA/)
  })

  it('bloqueia estabelecimento sem conta principal ativa ou com mais de uma principal ativa', () => {
    const semPrincipal = operacao()
    semPrincipal.notas[0].emissor.contasBancarias[0].principal = false
    expect(() => mapearGrupoParaVrs(agruparRemessa([semPrincipal], 'POR_CEDENTE')[0], config))
      .toThrow(/nao possui conta principal ativa estruturada/)

    const duplicada = operacao()
    duplicada.notas[0].emissor.contasBancarias.push(contaEstruturada('est-cedente-a', { id: 'conta-duplicada' }))
    expect(() => mapearGrupoParaVrs(agruparRemessa([duplicada], 'POR_CEDENTE')[0], config))
      .toThrow(/possui mais de uma conta principal ativa/)
  })

  it('cenario P4.1.1 D: bloqueia conta sem titular explicito', () => {
    const semTitular = operacao()
    semTitular.notas[0].emissor.contasBancarias[0].titular = null

    expect(() => mapearGrupoParaVrs(agruparRemessa([semTitular], 'POR_CEDENTE')[0], config))
      .toThrow(/REMESSA_VRS_TITULAR_CONTA_INDISPONIVEL/)
  })

  it('cenario P4.1.1 E: bloqueia titular pertencente a outro Cedente', () => {
    const titularCruzado = operacao()
    titularCruzado.notas[0].emissor.contasBancarias[0].titular = {
      estabelecimentoId: 'est-outro-cedente',
      cedenteId: 'cedente-b',
      cpfCnpj: '98765432000198',
      nome: 'Outro Cedente',
    }

    expect(() => mapearGrupoParaVrs(agruparRemessa([titularCruzado], 'POR_CEDENTE')[0], config))
      .toThrow(/REMESSA_VRS_TITULAR_CONTA_INVALIDO/)
  })
})


describe('VRS identidades legadas e duplicatas V4', () => {
  const nf = '11111111-2222-3333-4444-555555555555'
  const mapear = (op: RemessaOperacaoCanonica) => mapearGrupoParaVrs(agruparRemessa([op], 'POR_CEDENTE')[0], config)

  it.each([1, '01', '001'])('normaliza o numero original %s', numero => {
    expect(chaveAtivoVrs(nf)).toBe(nf)
    expect(chaveParcelaVrs(nf, numero)).toBe(`${nf}_001`)
    expect(chaveParcelaVrs(nf, 10)).toBe(`${nf}_010`)
  })
  it.each(['A1', '', '1.0', ' 1', '-1', 0, -1, 1.5, 1000, NaN])('bloqueia parcela invalida %s', numero => {
    expect(() => chaveParcelaVrs(nf, numero)).toThrow(/Numero original/)
  })
  it('bloqueia identificador nao persistido', () => {
    expect(() => chaveAtivoVrs('nf-inventada')).toThrow(/UUID/)
  })
  it.each([[1], [1, 2, 3], [2, 4]])('golden CSV e XLSX com selecao %s', async (...numeros) => {
    const op = operacao()
    op.notas[0].numero = '000100'
    op.notas[0].chaveAcesso = '0'.repeat(44)
    op.notas[0].parcelasSelecionadas = numeros.map(numero => ({ ...op.notas[0].parcelasSelecionadas[0], id: `persistido-${numero}`, numero }))
    const mapped = mapear(op)
    const csv = serializarVrsInclusaoCsv(mapped).conteudo
    const rows = csv.toString('utf8').replace(/^\uFEFF/, '').trim().split('\r\n').map(row => row.split(';'))
    expect(rows.filter(row => row[0] === 'ATIVO').map(row => row[1])).toEqual(numeros.map(numero => `000100/${numero}`))
    expect(rows.filter(row => row[0] === 'ATIVO').map(row => row[27])).toEqual(numeros.map(numero => `000100${numero}`))
    expect(rows[1].slice(36)).toEqual(['0'.repeat(44), 'em transito', `000100/${numeros[0]}_12345678000195`, '', ''])
    expect(rows.filter(row => row[0] === 'FLUXO').map(row => row.slice(1, 3))).toEqual(numeros.map(numero => [`000100/${numero}`, `000100/${numero}-1`]))
    const zip = await JSZip.loadAsync(await gerarVrsInclusaoXlsx(mapped))
    for (let sheet = 1; sheet <= 4; sheet++) {
      const tipo = ['HEADER', 'ATIVO', 'FLUXO', 'PAGAMENTO'][sheet - 1]
      const xml = await zip.file(`xl/worksheets/sheet${sheet}.xml`)!.async('text')
      const data = [...xml.matchAll(/<row r="[0-9]+">(.*?)<\/row>/g)].slice(1)
        .map(row => [...row[1].matchAll(/<c [^>]*t="inlineStr"><is><t>(.*?)<\/t><\/is><\/c>/g)].map(cell => cell[1]))
      expect(data).toEqual(rows.filter(row => row[0] === tipo).map(row => row.slice(1)))
    }
  })
  it('mantem referencias distintas entre NFs e rejeita colisao', () => {
    const op = operacao()
    op.notas.push({ ...structuredClone(op.notas[0]), numero: '101', id: '22222222-2222-3333-4444-555555555555' })
    const mapped = mapear(op)
    expect(new Set(mapped.ativos.map(a => a.chaveUnicaAtivo)).size).toBe(6)
    expect(new Set(mapped.fluxos.map(f => f.chaveUnicaParcela)).size).toBe(6)
    for (const f of mapped.fluxos) expect(mapped.ativos.find(a => a.chaveUnicaAtivo === f.chaveUnicaAtivo)).toMatchObject({ notaFiscalId: f.notaFiscalId, parcelaId: f.parcelaId })
    op.notas[1].numero = '100'
    expect(() => mapear(op)).toThrow(/repetida/)
  })
  it('rejeita numero original duplicado mesmo com IDs internos diferentes', () => {
    const op = operacao()
    op.notas[0].parcelasSelecionadas[1].numero = 2
    expect(() => mapear(op)).toThrow(/FLUXO repetida/)
  })
  it.each([1, '01', '001'])('V4 normaliza parcela %s sem alterar o numero da NF', numero => {
    expect(identidadeDuplicataVrs('0003518', numero)).toEqual({ chaveAtivo: '0003518/1', chaveFluxo: '0003518/1-1', numeroEmissao: '00035181' })
  })
  it.each(['A1', '', '1.0', ' 1', '-1', 0, -1, 1.5, 1000, NaN])('V4 rejeita parcela invalida %s', numero => {
    expect(() => identidadeDuplicataVrs('3518', numero)).toThrow(/Numero original/)
  })
  it.each(['', '3518/4', '../3518', '=3518', '3518;1', ' 3518', '3518\n', 'x'.repeat(100)])('V4 rejeita numero de NF invalido %s', numero => {
    expect(() => identidadeDuplicataVrs(numero, 1)).toThrow(/Numero da NF/)
  })
  it('V4 respeita os limites das chaves sem truncar ou colidir', () => {
    expect(identidadeDuplicataVrs('1'.repeat(94), 999).chaveFluxo).toHaveLength(100)
    expect(() => identidadeDuplicataVrs('1'.repeat(95), 999)).toThrow(/limite/)
    expect(identidadeDuplicataVrs('3518', 4)).toEqual({ chaveAtivo: '3518/4', chaveFluxo: '3518/4-1', numeroEmissao: '35184' })
    expect(VRS_LAYOUT_VERSION).toBe('inclusao_v5_chave_interna_taxa')
  })
  it('V4 segue os valores e vencimentos por duplicata, sem repetir o total da NF', () => {
    const op = operacao()
    op.notas[0].numero = '3518'
    op.notas[0].valorBruto = 13567.44
    op.notas[0].parcelasSelecionadas = [
      { id: 'qa-p4', numero: 4, valorNominal: 2261.24, valorPresente: 2213, vencimento: '2026-11-13', taxaMensal: 2 },
      { id: 'qa-p5', numero: 5, valorNominal: 2261.24, valorPresente: 2192.64, vencimento: '2026-11-28', taxaMensal: 2 },
    ]
    const before = structuredClone(op)
    const mapped = mapear(op)
    expect(mapped.ativos.map(a => [a.campos[1], a.campos[18], a.campos[19], a.campos[20], a.campos[22], a.campos[23], a.campos[27], a.campos[32], a.campos[33], a.campos[34]]))
      .toEqual([
        ['3518/4', '2261,24', '2213,00', '2261,24', '', '13/11/2026', '35184', '1', '2213,00', '2261,24'],
        ['3518/5', '2261,24', '2192,64', '2261,24', '', '28/11/2026', '35185', '1', '2192,64', '2261,24'],
      ])
    expect(mapped.pagamento[7]).toBe('4405,64')
    expect(mapped.fluxos.map(f => [f.campos[1], f.campos[2], f.campos[4], f.campos[9]])).toEqual([
      ['3518/4', '3518/4-1', '13/11/2026', '2261,24'], ['3518/5', '3518/5-1', '28/11/2026', '2261,24'],
    ])
    expect(op).toEqual(before)
  })
  it.each([NaN, Infinity, -Infinity, -1])('V4 rejeita valores nao finitos/negativos %s', valor => {
    const nominal = operacao(), compra = operacao()
    nominal.notas[0].parcelasSelecionadas[0].valorNominal = valor
    compra.notas[0].parcelasSelecionadas[0].valorPresente = valor
    expect(() => mapear(nominal)).toThrow(/valor nominal invalido/)
    expect(() => mapear(compra)).toThrow(/memoria financeira/)
  })
  it('V4 permite parcelas distintas da mesma NF em operacoes distintas, sem duplicar o ativo', () => {
    const primeira = operacao(), segunda = operacao()
    primeira.notas[0].parcelasSelecionadas = primeira.notas[0].parcelasSelecionadas.slice(0, 1)
    segunda.id = 'segunda-operacao'
    segunda.notas[0].parcelasSelecionadas = segunda.notas[0].parcelasSelecionadas.slice(1, 2)
    const mapped = mapearGrupoParaVrs(agruparRemessa([primeira, segunda], 'POR_CEDENTE')[0], config)
    expect(mapped.ativos.map(a => a.chaveUnicaAtivo)).toEqual(['100/2', '100/3'])
    expect(mapped.pagamento[7]).toBe('1880,00')
  })
  it.each([['cte', 'em transito'], ['comprovante_entrega', 'entregue']] as const)('V4 serializa %s nos dois registros e preserva chave NFe no FLUXO', (familia, status) => {
    const op = operacao()
    op.notas[0].classificacaoLogistica = classificarStatusLogisticoPreCessao([
      { familia, documentoId: 'qa-evidencia', versaoId: 'qa-versao', versaoStatus: 'aprovado' },
    ])
    const mapped = mapear(op)
    for (const ativo of mapped.ativos) expect(ativo.campos.slice(36)).toEqual([op.notas[0].chaveAcesso, status, `${ativo.chaveUnicaAtivo}_12345678000195`, '', ''])
    for (const fluxo of mapped.fluxos) expect(fluxo.campos.slice(10)).toEqual([op.notas[0].chaveAcesso, status, `${fluxo.chaveUnicaAtivo}_12345678000195`, '', ''])
  })
  it.each([undefined, classificarStatusLogisticoPreCessao([]), classificarStatusLogisticoPreCessao([
    { familia: 'comprovante_entrega', documentoId: 'qa-pendente', versaoId: 'qa-v1', versaoStatus: 'enviado' },
  ])])('V4 nao inventa estado quando falta evidencia aprovada: %s', classificacao => {
    const op = operacao()
    op.notas[0].classificacaoLogistica = classificacao
    expect(() => mapear(op)).toThrow(/status logistico indeterminado/)
  })
  it('produz bytes identicos em regeneracoes realizadas em datas diferentes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
      const mapped = mapear(operacao())
      const first = await gerarVrsInclusaoXlsx(mapped)
      const csv = serializarVrsInclusaoCsv(mapped)
      const secondGroup = { ...mapped, cedenteCnpj: '22222222000122' }
      const firstZip = await gerarDownloadExcelVrs([mapped, secondGroup])
      vi.setSystemTime(new Date('2027-12-31T23:59:58Z'))
      expect(await gerarVrsInclusaoXlsx(mapear(operacao()))).toEqual(first)
      expect(serializarVrsInclusaoCsv(mapear(operacao()))).toEqual(csv)
      expect((await gerarDownloadExcelVrs([mapped, secondGroup])).conteudo).toEqual(firstZip.conteudo)
    } finally { vi.useRealTimers() }
  })
})
