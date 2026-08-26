import { describe, expect, it } from 'vitest'
import { agruparRemessa, chaveUnicaAtivo, chaveUnicaParcela, type RemessaOperacaoCanonica } from '@/lib/remessas/domain'
import { consolidarStatusSubremessas } from '@/lib/remessas/service.server'
import { mapearGrupoParaVrs, VrsMappingError } from './mapper'
import { serializarVrsInclusaoCsv } from './csv'

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

function operacao(cedenteId = 'cedente-a', cnpj = '12345678000195'): RemessaOperacaoCanonica {
  return {
    id: `operacao-${cedenteId}`,
    fundoId: 'fundo-1',
    cedenteFundoId: `vinculo-${cedenteId}`,
    politicaOperacionalVersaoId: 'politica-v1',
    cedente: {
      id: cedenteId, cnpj, razaoSocial: `Cedente ${cedenteId}`, coobrigacao: true,
      bancoCodigo: '001', agencia: '1234', conta: '100-7',
    },
    estabelecimento: { id: `est-${cedenteId}`, cnpj, razaoSocial: `Cedente ${cedenteId}` },
    notas: [{
      id: `nf-${cedenteId}`,
      numero: '100',
      serie: '1',
      chaveAcesso: '35260812345678000195550010000001001000000010',
      dataEmissao: '2026-08-01',
      valorBruto: 3000,
      quantidadeParcelasOriginal: 5,
      emissor: { estabelecimentoId: `est-${cedenteId}`, cnpj, nome: `Cedente ${cedenteId}` },
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
})
