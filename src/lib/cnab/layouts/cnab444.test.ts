import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIGURACAO_CNAB_LEGADO_PADRAO, calcularHashConfiguracaoCnab, type RemessaOperacao } from '@/lib/cnab/domain'
import { geradorCnab444, validarCnab444Conteudo } from '@/lib/cnab/layouts/cnab444'

type Golden = {
  lineCount: number
  lineLength: number
  header: Record<string, string>
  detail: Record<string, string>
  trailer: Record<string, string>
}

const golden = JSON.parse(
  readFileSync(join(process.cwd(), 'src/lib/cnab/__fixtures__/cnab444-golden.json'), 'utf8'),
) as Golden

function sliceCnab(line: string, start: number, end: number) {
  return line.slice(start - 1, end)
}

function sampleInput(configOverrides: Partial<RemessaOperacao['configuracao']> = {}): RemessaOperacao {
  const configBase = CONFIGURACAO_CNAB_LEGADO_PADRAO
  const configuracao = {
    configuracaoId: 'config-1',
    versaoId: 'versao-1',
    versao: 1,
    hash: calcularHashConfiguracaoCnab(configBase),
    codigo: 'cnab444_legado',
    ...configBase,
    ...configOverrides,
  }

  return {
    fundo: {
      id: 'fundo-1',
      nome: 'Fundo BW',
      cnpj: '11.111.111/0001-11',
    },
    cedente: {
      id: 'cedente-1',
      razaoSocial: 'Cedente Ácme Ltda',
      cnpj: '12.345.678/0001-12',
      coobrigacao: true,
    },
    operacoes: [{
      id: '11111111-2222-3333-4444-555555555555',
      cedenteId: 'cedente-1',
      cedenteFundoId: 'cedente-fundo-1',
      aprovadoEm: '2026-04-10T00:00:00.000Z',
      createdAt: '2026-04-09T00:00:00.000Z',
    }],
    titulos: [{
      notaFiscalId: 'nf-1',
      numero: '987654321',
      serie: '1',
      chaveAcesso: '35260412345678000112550010009876541000043210',
      dataEmissao: '2026-04-10',
      dataVencimento: '2026-08-15',
      valorFace: 1234.56,
      valorPresente: 1000.12,
      sacadoCnpj: '98.765.432/0001-98',
      sacadoNome: 'Sacado São João S/A',
    }],
    conta: {
      banco: configBase.banco,
      agencia: configBase.agencia,
      conta: configBase.conta,
      digitoConta: configBase.digitoConta,
      carteira: configBase.carteira,
      convenio: configBase.convenio,
    },
    identificadores: {
      dataGeracao: '2026-07-21T00:00:00.000Z',
      sequencial: 42,
      nomeArquivo: 'REM_FUNDO_20260721_0000042.REM',
    },
    configuracao,
  }
}

describe('gerador CNAB444', () => {
  it('gera arquivo posicional compatível com o golden da configuração legado', () => {
    const resultado = geradorCnab444.gerar(sampleInput())
    const [header, detail, trailer] = resultado.linhas

    expect(resultado.linhas).toHaveLength(golden.lineCount)
    expect(resultado.linhas.every((line) => line.length === golden.lineLength)).toBe(true)
    expect(resultado.conteudo).toContain('\r\n')

    expect(sliceCnab(header, 1, 1)).toBe(golden.header.recordType)
    expect(sliceCnab(header, 3, 9).trim()).toBe(golden.header.literalRemessa)
    expect(sliceCnab(header, 10, 11)).toBe(golden.header.codigoServico)
    expect(sliceCnab(header, 12, 26).trim()).toBe(golden.header.literalServico)
    expect(sliceCnab(header, 27, 46)).toBe(golden.header.codigoOriginador)
    expect(sliceCnab(header, 47, 76).trim()).toBe(golden.header.nomeOriginador)
    expect(sliceCnab(header, 77, 79)).toBe(golden.header.codigoBanco)
    expect(sliceCnab(header, 80, 94).trim()).toBe(golden.header.nomeBanco)
    expect(sliceCnab(header, 95, 100)).toBe(golden.header.dataGravacao)
    expect(sliceCnab(header, 109, 110)).toBe(golden.header.identificacaoSistema)
    expect(sliceCnab(header, 111, 117)).toBe(golden.header.sequencialArquivo)
    expect(sliceCnab(header, 439, 444)).toBe(golden.header.sequencialRegistro)

    expect(sliceCnab(detail, 1, 1)).toBe(golden.detail.recordType)
    expect(sliceCnab(detail, 21, 22)).toBe(golden.detail.coobrigacao)
    expect(sliceCnab(detail, 38, 62).trim()).toBe(golden.detail.seuNumero)
    expect(sliceCnab(detail, 109, 110)).toBe(golden.detail.ocorrencia)
    expect(sliceCnab(detail, 111, 120).trim()).toBe(golden.detail.documento)
    expect(sliceCnab(detail, 121, 126)).toBe(golden.detail.vencimento)
    expect(sliceCnab(detail, 127, 139)).toBe(golden.detail.valorTitulo)
    expect(sliceCnab(detail, 148, 149)).toBe(golden.detail.especieTitulo)
    expect(sliceCnab(detail, 151, 156)).toBe(golden.detail.emissao)
    expect(sliceCnab(detail, 193, 205)).toBe(golden.detail.valorPresente)
    expect(sliceCnab(detail, 219, 220)).toBe(golden.detail.tipoInscricaoSacado)
    expect(sliceCnab(detail, 221, 234)).toBe(golden.detail.sacadoCnpj)
    expect(sliceCnab(detail, 235, 274).trim()).toBe(golden.detail.nomeSacado)
    expect(sliceCnab(detail, 315, 323).trim()).toBe(golden.detail.numeroNf)
    expect(sliceCnab(detail, 327, 334)).toBe(golden.detail.cepSacado)
    expect(sliceCnab(detail, 335, 380).trim()).toBe(golden.detail.nomeCedente)
    expect(sliceCnab(detail, 381, 394)).toBe(golden.detail.cedenteCnpj)
    expect(sliceCnab(detail, 395, 438)).toBe(golden.detail.chaveNfe)
    expect(sliceCnab(detail, 439, 444)).toBe(golden.detail.sequencialRegistro)

    expect(sliceCnab(trailer, 1, 1)).toBe(golden.trailer.recordType)
    expect(sliceCnab(trailer, 439, 444)).toBe(golden.trailer.sequencialRegistro)
    expect(validarCnab444Conteudo(resultado.conteudo, 1)).toMatchObject({ valido: true })
  })

  it('rejeita remessa sem vínculo histórico cedente-fundo no modelo intermediário', () => {
    const input = sampleInput()
    input.operacoes[0].cedenteFundoId = null

    expect(geradorCnab444.validar(input).erros.join(' ')).toContain('vinculo historico cedente-fundo')
  })

  it('rejeita CNPJ de sacado inválido antes da serialização', () => {
    const input = sampleInput()
    input.titulos[0].sacadoCnpj = '123'

    expect(() => geradorCnab444.gerar(input)).toThrow(/CNPJ do sacado invalido/i)
  })

  it('gera código originador específico para cada fundo', () => {
    const fundoA = sampleInput({ codigoOriginador: '12345678901234567890' })
    const fundoB = sampleInput({ codigoOriginador: '99999999999999999999' })
    fundoA.fundo.id = 'fundo-a'
    fundoB.fundo.id = 'fundo-b'

    expect(sliceCnab(geradorCnab444.gerar(fundoA).linhas[0], 27, 46)).toBe('12345678901234567890')
    expect(sliceCnab(geradorCnab444.gerar(fundoB).linhas[0], 27, 46)).toBe('99999999999999999999')
  })

  it('preserva zeros à esquerda do código originador como texto numérico', () => {
    const input = sampleInput({ codigoOriginador: '000123' })

    expect(sliceCnab(geradorCnab444.gerar(input).linhas[0], 27, 46)).toBe('00000000000000000123')
  })

  it('rejeita código originador ausente, longo ou com caracteres inválidos', () => {
    expect(geradorCnab444.validar(sampleInput({ codigoOriginador: '' })).erros.join(' ')).toContain('Codigo originador e obrigatorio')
    expect(geradorCnab444.validar(sampleInput({ codigoOriginador: '123456789012345678901' })).erros.join(' ')).toContain('maximo 20')
    expect(geradorCnab444.validar(sampleInput({ codigoOriginador: 'ABC123' })).erros.join(' ')).toContain('somente digitos')
  })

  it('mantém remessa histórica vinculada ao código da versão anterior', () => {
    const versaoAnterior = sampleInput({ versaoId: 'versao-antiga', versao: 1, codigoOriginador: '00000000000000000001' })
    const novaVersao = sampleInput({ versaoId: 'versao-nova', versao: 2, codigoOriginador: '00000000000000000002' })

    const headerHistorico = geradorCnab444.gerar(versaoAnterior).linhas[0]
    const headerNovo = geradorCnab444.gerar(novaVersao).linhas[0]

    expect(sliceCnab(headerHistorico, 27, 46)).toBe('00000000000000000001')
    expect(sliceCnab(headerNovo, 27, 46)).toBe('00000000000000000002')
    expect(sliceCnab(headerHistorico, 27, 46)).not.toBe(sliceCnab(headerNovo, 27, 46))
  })

  it('não mantém constante residual de código originador no gerador ou no serializador', () => {
    const geradorFonte = readFileSync(join(process.cwd(), 'src/lib/cnab/gerarCnab444.ts'), 'utf8')
    const layoutFonte = readFileSync(join(process.cwd(), 'src/lib/cnab/layouts/cnab444.ts'), 'utf8')

    expect(geradorFonte).not.toContain('00000000000000500497')
    expect(layoutFonte).not.toContain('00000000000000500497')
    expect(layoutFonte).toContain('cfg.codigoOriginador')
  })
})
