import { describe, expect, it } from 'vitest'
import {
  interpretarProtocoloRelatorioVortx,
  prepararSolicitacaoRelatorioVortx,
  TIPOS_RELATORIO_VORTX,
  VORTX_RELATORIO_SOLICITAR_PATH,
} from './relatorios-contrato'

const hoje = '2026-10-19'
const pedido = {
  codigoCarteira: 'carteira-qa_01.v2',
  dataInicio: '2026-10-01',
  dataFim: '2026-10-18',
  tipoRelatorio: 'Inclusao',
}
const protocolo = {
  id: 'd5f38c9a-770e-4227-9b1f-42f48641e94e',
  status: 0,
  dataSolicitacao: '2026-10-19T12:00:00.123Z',
}

describe('contrato documentado de solicitacao Vortx VRS 2', () => {
  it('usa o path V1 documentado sem confundi-lo com a autenticacao V2', () => {
    expect(VORTX_RELATORIO_SOLICITAR_PATH).toBe('/v1/vrs/externo/solicitar')
  })

  it.each(TIPOS_RELATORIO_VORTX)('prepara %s como CSV sem inventar codigo numerico', (tipoRelatorio) => {
    const body = prepararSolicitacaoRelatorioVortx({ ...pedido, tipoRelatorio, dataReferencia: '2026-10-18' }, hoje)
    expect(body).toEqual({ ...pedido, tipoRelatorio, dataReferencia: '2026-10-18', extensaoArquivo: 2 })
  })

  it.each(['Inclusao', 'Exclusao'])('explicita referencia igual ao fim quando omitida para %s', (tipoRelatorio) => {
    expect(prepararSolicitacaoRelatorioVortx({ ...pedido, tipoRelatorio }, hoje).dataReferencia).toBe(pedido.dataFim)
  })

  it.each(['PosicaoAtivo', 'PosicaoParcela'])('nao presume referencia de %s', (tipoRelatorio) => {
    expect(() => prepararSolicitacaoRelatorioVortx({ ...pedido, tipoRelatorio }, hoje)).toThrow('referencia explicita')
  })

  it('preserva referencia e formato Excel explicitamente selecionados', () => {
    expect(prepararSolicitacaoRelatorioVortx({ ...pedido, dataReferencia: '2026-10-10', extensaoArquivo: 1 }, hoje))
      .toMatchObject({ dataReferencia: '2026-10-10', extensaoArquivo: 1 })
  })

  it('reutiliza o formato de carteira da configuracao existente, sem alterar o input', () => {
    const input = { ...pedido, codigoCarteira: '  carteira-qa_01.v2  ' }
    expect(prepararSolicitacaoRelatorioVortx(input, hoje).codigoCarteira).toBe(pedido.codigoCarteira)
    expect(input.codigoCarteira).toBe('  carteira-qa_01.v2  ')
  })

  it('aceita data atual e fevereiro bissexto, sem depender do relogio do teste', () => {
    expect(prepararSolicitacaoRelatorioVortx({ ...pedido, dataFim: hoje }, hoje).dataReferencia).toBe(hoje)
    expect(prepararSolicitacaoRelatorioVortx({ ...pedido, dataInicio: '2024-02-28', dataFim: '2024-02-29' }, hoje).dataFim)
      .toBe('2024-02-29')
  })

  it.each([
    { codigoCarteira: '' }, { codigoCarteira: 'x'.repeat(101) },
    { codigoCarteira: '../outra' }, { codigoCarteira: 'carteira\nextra' },
    { tipoRelatorio: 'CARTEIRA' }, { tipoRelatorio: 'Consolidado' },
    { tipoRelatorio: 0 }, { tipoRelatorio: '7' },
    { extensaoArquivo: 0 }, { extensaoArquivo: '2' },
    { dataInicio: '2026-02-30' }, { dataFim: '2026-02-29' },
    { dataFim: '18/10/2026' }, { dataReferencia: '2026-10-18T00:00:00Z' },
    { dataInicio: '2026-10-18' }, { dataInicio: '2026-10-19' },
    { dataInicio: '2026-10-20', dataFim: '2026-10-21' },
    { dataFim: '2026-10-20' }, { dataReferencia: '2026-10-20' },
    { fundoId: 'fundo-do-payload' }, { callbackUrl: 'https://example.invalid' },
  ])('rejeita parametros invalidos ou campos nao documentados: %j', (patch) => {
    expect(() => prepararSolicitacaoRelatorioVortx({ ...pedido, ...patch }, hoje))
      .toThrow(expect.objectContaining({ categoria: 'configuracao' }))
  })

  it.each([null, [], 'pedido'])('rejeita entrada sem objeto: %j', (entrada) => {
    expect(() => prepararSolicitacaoRelatorioVortx(entrada, hoje)).toThrow()
  })

  it.each(['2026-02-30', '19/10/2026', ''])('rejeita referencia de hoje invalida: %s', (dataAtual) => {
    expect(() => prepararSolicitacaoRelatorioVortx(pedido, dataAtual)).toThrow()
  })

  it('produz o mesmo body para a mesma entrada sem disparar pedidos ou gerar protocolo local', () => {
    const primeiro = prepararSolicitacaoRelatorioVortx(pedido, hoje)
    expect(prepararSolicitacaoRelatorioVortx(pedido, hoje)).toEqual(primeiro)
    expect(primeiro).not.toHaveProperty('id')
    expect(primeiro).not.toHaveProperty('status')
  })
})

describe('protocolo de relatorio Vortx, ainda pendente', () => {
  it('aceita o schema direto e o envelope do exemplo documental', () => {
    expect(interpretarProtocoloRelatorioVortx(protocolo)).toEqual(protocolo)
    expect(interpretarProtocoloRelatorioVortx({ data: protocolo })).toEqual(protocolo)
  })

  it('descarta campos nao contratuais sem promovê-los a resultado de importacao', () => {
    expect(interpretarProtocoloRelatorioVortx({ ...protocolo, arquivoPronto: true, linhas: [{ valor: 100 }] }))
      .toEqual(protocolo)
  })

  it.each([
    null, [], {}, { data: null }, { data: [] },
    { ...protocolo, id: 'nao-uuid' }, { ...protocolo, id: undefined },
    { ...protocolo, status: 1 }, { ...protocolo, status: '0' },
    { ...protocolo, dataSolicitacao: '2026-02-30T12:00:00Z' },
    { ...protocolo, dataSolicitacao: '2026-10-19' },
    { ...protocolo, data: { ...protocolo, id: '10cb9f4e-761b-4e5e-a817-b6b12bf825ab' } },
    { data: protocolo, status: 0 },
  ])('rejeita resposta incompleta, ambigua ou fora do contrato: %j', (resposta) => {
    expect(() => interpretarProtocoloRelatorioVortx(resposta))
      .toThrow(expect.objectContaining({ categoria: 'resposta_inesperada' }))
  })

  it('nao propaga conteudo arbitrario ou segredos da resposta em erros', () => {
    const marcador = 'CONTEUDO_SINTETICO_NAO_PROPAGAR'
    expect(() => interpretarProtocoloRelatorioVortx({ error: marcador })).toThrow('incompleta ou inesperada')
    try {
      interpretarProtocoloRelatorioVortx({ error: marcador })
    } catch (error) {
      expect(String(error)).not.toContain(marcador)
    }
  })
})
