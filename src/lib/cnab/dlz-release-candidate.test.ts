import { describe, expect, it } from 'vitest'
import { calcularHashConfiguracaoCnab, type RemessaOperacao } from './domain'
import { geradorCnab444, validarCnab444Conteudo } from './layouts/cnab444'

const config = {
  layout: 'cnab444' as const, versaoLayout: 'H/D/T', codigoBanco: '001', banco: 'BANCO DO BRASIL SA',
  agencia: '00000', conta: '0000000000', digitoConta: '0', carteira: '000', convenio: '00000000000000000000',
  codigoOriginador: '00000000000000500497', codigoEmpresa: '00000000000000500497', tipoInscricao: '02',
  numeroInscricao: '62342629000177', especieTitulo: '61', tipoRecebivel: '01',
  configuracao: { literalRemessa: 'REMESSA', codigoServico: '01', literalServico: 'COBRANCA', identificacaoSistema: 'MX', sequencialHeaderInicial: 1, ocorrencia: '01', caracteristicaEspecial: '00', modalidadeOperacao: '0000', naturezaOperacao: '00', origemRecurso: '0000', numeroBancoCobranca: '000', agenciaDepositaria: '00000', condicaoPapeleta: '1', emitePapeletaDebAuto: 'N', tipoPessoaCedente: '02', tipoInscricaoSacado: '02', cepSacadoDefault: '00000000' },
}

describe('CNAB DLZ/HEALTH release candidate', () => {
  it('preserva originador textual, layout e posicoes sem envio externo', () => {
    const input: RemessaOperacao = {
      fundo: { id: '7a114257-7816-468e-adf4-d796b93364df', nome: 'DLZ FUNDO DE INVESTIMENTO EM DIREITOS CREDITORIOS', cnpj: '62.342.629/0001-77' },
      cedente: { id: 'cedente', razaoSocial: 'CEDENTE CONTROLADO', cnpj: '32.622.037/0001-48', coobrigacao: true },
      operacoes: [{ id: 'operacao', cedenteId: 'cedente', cedenteFundoId: 'vinculo', aprovadoEm: '2026-08-27T00:00:00Z', createdAt: '2026-08-27T00:00:00Z' }],
      titulos: [{ notaFiscalId: 'nf', numero: '1001', serie: '1', chaveAcesso: '35260832622037000148550010000010011000000015', dataEmissao: '2026-08-27', dataVencimento: '2026-11-25', valorFace: 1000, valorPresente: 950, sacadoCnpj: '11.344.038/0021-41', sacadoNome: 'SACADO CONTROLADO' }],
      conta: { banco: config.banco, agencia: config.agencia, conta: config.conta, digitoConta: config.digitoConta, carteira: config.carteira, convenio: config.convenio },
      identificadores: { dataGeracao: '2026-08-27T00:00:00Z', sequencial: 1, nomeArquivo: 'DLZ_20260827_0000001.REM' },
      configuracao: { configuracaoId: 'config', versaoId: 'version', versao: 1, hash: calcularHashConfiguracaoCnab(config), codigo: 'dlz_health_legacy', ...config },
    }
    const generated = geradorCnab444.gerar(input)
    expect(generated.linhas).toHaveLength(3)
    expect(generated.linhas.every((line) => line.length === 444)).toBe(true)
    expect(generated.linhas[0].slice(26, 46)).toBe('00000000000000500497')
    expect(generated.linhas[0].slice(76, 79)).toBe('001')
    expect(validarCnab444Conteudo(generated.conteudo, 1).valido).toBe(true)
  })
})
