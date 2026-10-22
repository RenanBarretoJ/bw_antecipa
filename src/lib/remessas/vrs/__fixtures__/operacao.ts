import type { RemessaContaBancariaCanonica, RemessaOperacaoCanonica } from '@/lib/remessas/domain'
import { classificarStatusLogisticoPreCessao } from '@/lib/logistica/evidencias-logisticas'

export const config = {
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

export function contaEstruturada(
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

export function operacao(cedenteId = 'cedente-a', cnpj = '12345678000195'): RemessaOperacaoCanonica {
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
      classificacaoLogistica: classificarStatusLogisticoPreCessao([
        { familia: 'cte', documentoId: 'qa-cte', versaoId: 'qa-cte-v1', versaoStatus: 'aprovado' },
      ]),
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
