import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import {
  agruparRemessa,
  chaveUnicaAtivo,
  chaveUnicaParcela,
  type RemessaContaBancariaCanonica,
  type RemessaOperacaoCanonica,
} from '@/lib/remessas/domain'
import { consolidarStatusSubremessas } from '@/lib/remessas/service.server'
import { chaveAtivoVrs, chaveParcelaVrs } from './chaves'
import { mapearGrupoParaVrs, VrsMappingError } from './mapper'
import { serializarVrsInclusaoCsv } from './csv'
import { gerarDownloadExcelVrs, gerarVrsInclusaoXlsx } from './xlsx'

const config = {
  codigo_carteira: 'CART01',
  vrs_inclusao: {
    termo: 'TERMO_EXEMPLO',
    cnpj_originador: '68522785000104',
    tipo_preco: 'PREFIXADO',
    metodo_preco: 'PREFIXADO',
    modalidade_operacao: '0202',
    registradora: 'CERC',
  },
}

function contaEstruturada(
  estabelecimentoId: string,
  overrides: Partial<RemessaContaBancariaCanonica> = {},
): RemessaContaBancariaCanonica {
  return {
    id: `conta-${estabelecimentoId}`,
    estabelecimentoId,
    titular: {
      estabelecimentoId,
      cedenteId: 'cedente-a',
      cpfCnpj: '12345678000195',
      nome: 'Cedente cedente-a',
    },
    bancoCodigo: '001',
    bancoIspb: '00000000',
    bancoNome: 'BCO DO BRASIL S.A.',
    agencia: '1234',
    conta: '100-7',
    principal: true,
    ativa: true,
    ...overrides,
  }
}

function operacao(cedenteId = 'cedente-a', cnpj = '12345678000195'): RemessaOperacaoCanonica {
  return {
    id: `operacao-${cedenteId}`,
    fundoId: 'fundo-1',
    cedenteFundoId: `vinculo-${cedenteId}`,
    politicaOperacionalVersaoId: 'politica-v1',
    cedente: {
      id: cedenteId, cnpj, razaoSocial: `Cedente ${cedenteId}`, coobrigacao: true,
    },
    estabelecimento: { id: `est-${cedenteId}`, cnpj, razaoSocial: `Cedente ${cedenteId}` },
    notas: [{
      id: '11111111-2222-3333-4444-555555555555',
      numero: '100',
      serie: '1',
      chaveAcesso: '35260812345678000195550010000001001000000010',
      dataEmissao: '2026-08-01',
      valorBruto: 3000,
      quantidadeParcelasOriginal: 5,
      emissor: {
        estabelecimentoId: `est-${cedenteId}`,
        cnpj,
        nome: `Cedente ${cedenteId}`,
        contasBancarias: [contaEstruturada(`est-${cedenteId}`, {
          titular: {
            estabelecimentoId: `est-${cedenteId}`,
            cedenteId,
            cpfCnpj: cnpj,
            nome: `Cedente ${cedenteId}`,
          },
        })],
      },
      devedor: {
        cnpj: '98765432000198', nome: 'Devedor Ltda', cep: '01310100', endereco: 'Avenida Paulista',
        numero: '100', complemento: '', bairro: 'Bela Vista', municipio: 'Sao Paulo', uf: 'SP',
        email: 'financeiro@devedor.test', telefone: '11999990000',
      },
      parcelasSelecionadas: [
        { id: `parcela-2-${cedenteId}`, numero: 2, vencimento: '2026-09-01', valorNominal: 1000, valorPresente: 950, taxaMensal: 2 },
        { id: `parcela-3-${cedenteId}`, numero: 3, vencimento: '2026-10-01', valorNominal: 1000, valorPresente: 930, taxaMensal: 2 },
        { id: `parcela-5-${cedenteId}`, numero: 5, vencimento: '2026-12-01', valorNominal: 1000, valorPresente: 900, taxaMensal: 2 },
      ],
    }],
  }
}

describe('P4 - adapter Vortx VRS por Cedente', () => {
  it('preenche as posicoes fisicas 37 e 38 sem deslocar o restante do CSV', () => {
    const op = operacao()
    op.notas[0].numero = '000100'
    const mapped = mapearGrupoParaVrs(agruparRemessa([op], 'POR_CEDENTE')[0], config)
    const ativo = serializarVrsInclusaoCsv(mapped).conteudo.toString('utf8').split('\r\n')[1].split(';')
    expect(ativo).toHaveLength(41)
    expect(ativo.slice(35)).toEqual(['CERC', '000100', op.notas[0].chaveAcesso, '', '', ''])
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
    expect(ativo).toContain('<c r="AJ2" t="inlineStr"><is><t>100</t>')
    expect(ativo).toContain(`<c r="AK2" t="inlineStr"><is><t>${op.notas[0].chaveAcesso}</t>`)
    expect(ativo).toContain('<c r="F2" t="inlineStr"><is><t>01310100</t>')
    const fluxo = await zip.file('xl/worksheets/sheet3.xml')!.async('text')
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

  it('cenario A: gera HEADER, um ATIVO, somente os tres FLUXOS selecionados e PAGAMENTO', () => {
    const grupo = agruparRemessa([operacao()], 'POR_CEDENTE')[0]
    const mapped = mapearGrupoParaVrs(grupo, config)
    const csv = serializarVrsInclusaoCsv(mapped)
    const linhas = csv.conteudo.toString('utf8').replace(/^\uFEFF/, '').trim().split('\r\n')

    expect(linhas.map((linha) => linha.split(';')[0])).toEqual(['HEADER', 'ATIVO', 'FLUXO', 'FLUXO', 'FLUXO', 'PAGAMENTO'])
    expect(linhas[0].split(';')).toHaveLength(6)
    expect(linhas[1].split(';')).toHaveLength(41)
    expect(linhas.slice(2, 5).every((linha) => linha.split(';').length === 15)).toBe(true)
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

    const pagamento = mapearGrupoParaVrs(agruparRemessa([compartilhada], 'POR_CEDENTE')[0], config).pagamento
    expect(pagamento.slice(1, 7)).toEqual(['001', '1234', '100', '7', '12345678000195', 'Cedente cedente-a'])
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


describe('RLX VRS identidade serializada', () => {
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
    expect(rows[1][1]).toBe(nf)
    expect(rows[1][27]).toBe('000100')
    expect(rows[1].slice(36)).toEqual(['000100', '0'.repeat(44), '', '', ''])
    expect(rows.slice(2, -1).map(row => row.slice(1, 3))).toEqual(numeros.map(numero => [nf, `${nf}_${String(numero).padStart(3, '0')}`]))
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
    op.notas.push({ ...structuredClone(op.notas[0]), id: '22222222-2222-3333-4444-555555555555' })
    const mapped = mapear(op)
    expect(new Set(mapped.ativos.map(a => a.chaveUnicaAtivo)).size).toBe(2)
    expect(new Set(mapped.fluxos.map(f => f.chaveUnicaParcela)).size).toBe(6)
    for (const f of mapped.fluxos) expect(f.chaveUnicaAtivo).toBe(f.notaFiscalId)
    op.notas[1].id = nf
    expect(() => mapear(op)).toThrow(/repetida/)
  })
  it('rejeita numero original duplicado mesmo com IDs internos diferentes', () => {
    const op = operacao()
    op.notas[0].parcelasSelecionadas[1].numero = 2
    expect(() => mapear(op)).toThrow(/FLUXO repetida/)
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
