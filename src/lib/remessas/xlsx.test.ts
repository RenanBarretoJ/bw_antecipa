import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { RemessaLoteCanonico } from './domain'
import { gerarExcelConferenciaRemessa } from './xlsx'

const lote: RemessaLoteCanonico = {
  fundo: { id: 'fundo-1', nome: 'Fundo Teste', cnpj: '68522785000104' },
  integracao: { versaoId: 'versao-1', adapterKey: 'vortx_vrs', configuracao: {} },
  operacoes: [{
    id: 'operacao-1',
    fundoId: 'fundo-1',
    cedenteFundoId: 'vinculo-1',
    politicaOperacionalVersaoId: 'politica-v1',
    cedente: {
      id: 'cedente-1', cnpj: '12345678000195', razaoSocial: 'Cedente Teste',
      coobrigacao: true,
    },
    estabelecimento: { id: 'est-1', cnpj: '12345678000195', razaoSocial: 'Cedente Teste' },
    notas: [{
      id: 'nf-1', numero: '100', serie: '1', chaveAcesso: null, dataEmissao: '2026-08-01',
      valorBruto: 3000, quantidadeParcelasOriginal: 5,
      emissor: { estabelecimentoId: 'est-1', cnpj: '12345678000195', nome: 'Cedente Teste', contasBancarias: [] },
      devedor: {
        cnpj: '98765432000198', nome: 'Devedor Teste', cep: null, endereco: null,
        numero: null, complemento: null, bairro: null, municipio: null, uf: null,
        email: null, telefone: null,
      },
      parcelasSelecionadas: [
        { id: 'parcela-2', numero: 2, vencimento: '2026-09-01', valorNominal: 1000, valorPresente: 950, taxaMensal: 2 },
        { id: 'parcela-5', numero: 5, vencimento: '2026-12-01', valorNominal: 1000, valorPresente: 900, taxaMensal: 2 },
      ],
    }],
  }],
}

describe('P4 - Excel de conferencia', () => {
  it('gera um XLSX valido contendo somente as parcelas selecionadas', async () => {
    const buffer = await gerarExcelConferenciaRemessa(lote, 'VRS_CSV', 'POR_CEDENTE')
    const zip = await JSZip.loadAsync(buffer)
    const sheet = await zip.file('xl/worksheets/sheet1.xml')?.async('text')

    expect(zip.file('[Content_Types].xml')).not.toBeNull()
    expect(sheet).toContain('Cedente Teste')
    expect(sheet).toContain('parcela-2')
    expect(sheet).toContain('parcela-5')
    expect(sheet).not.toContain('parcela-1')
    expect(sheet).toContain('POR_CEDENTE')
  })
})
