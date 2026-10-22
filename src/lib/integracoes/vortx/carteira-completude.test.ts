import { afterEach, describe, expect, it, vi } from 'vitest'
import Decimal from 'decimal.js'
import { conferirCompletudeCarteiraVortx, configuracaoCarteiraConsolidadaSchema } from './carteira-completude'

const cnpjFundo = '12345678000190'
const dataReferencia = '2026-10-19'
const configuracao = {
  versao: 1,
  cotas: [
    { codigoCarteira: 'QA-J', rotulo: 'Junior' },
    { codigoCarteira: 'QA-M', rotulo: 'Mezza' },
    { codigoCarteira: 'QA-S', rotulo: 'Sub' },
  ],
}
const header = (carteira: string, pl: string | number = '100.00') => ({
  carteira, pl, cnpjFundo, dataAtual: `${dataReferencia}T03:00:00.000Z`, status: 'Ativa', nome: 'Cota sintetica',
})
const respostaCompleta = () => [{ carteiras: [header('QA-J', '0.10'), header('QA-M', '0.20'), header('QA-S', '100.1234')] }]
const conferir = (resposta: unknown, config: unknown = configuracao) => conferirCompletudeCarteiraVortx({ cnpjFundo, dataReferencia, configuracao: config, resposta })
const revisar = (motivo: string) => ({ estado: 'REVISAO_NECESSARIA', motivo })
afterEach(() => vi.useRealTimers())

describe('completude da Carteira JSON Vortx por roster do Fundo', () => {
  it('confere os headers do retorno de 20/10 informado pelo operador, sem somar ativos/passivos', () => {
    const configuracaoRlx = { versao: 1, cotas: [
      { codigoCarteira: '20672', rotulo: 'FIDC RLX SR' },
      { codigoCarteira: '20671', rotulo: 'FIDC RLX MZ' },
      { codigoCarteira: '20670', rotulo: 'FIDC RLX' },
    ] }
    const cabecalhos = [
      { carteira: '20672', pl: 12021826.39 },
      { carteira: '20671', pl: 13532225.29 },
      { carteira: '20670', pl: 4438232.36 },
    ].map(cota => ({ ...cota, cnpjFundo: '68522785000104', dataAtual: '2026-10-20T03:00:00.000Z', status: 'Ativa' }))
    const contexto = { cnpjFundo: '68522785000104', dataReferencia: '2026-10-20', configuracao: configuracaoRlx }
    expect(conferirCompletudeCarteiraVortx({ ...contexto, resposta: [{ carteiras: cabecalhos,
      ativos: [{ RendaFixa: { plTotal: 12021826.39 } }, { RendaFixa: { plTotal: 13532225.29 } },
        { Cotas: { plTotal: 6512859.26 }, ProvisaoAReceber: { plTotal: -2068724.1300000004 } }],
      passivos: [{ plTotal: -5902.77 }],
    }] })).toMatchObject({ estado: 'COMPLETA', patrimonioLiquidoTotal: '29992284.0400' })
    const parcial = conferirCompletudeCarteiraVortx({ ...contexto, resposta: [{ carteiras: cabecalhos.slice(0, 2) }] })
    expect(parcial).toMatchObject({ estado: 'AGUARDANDO_COTAS', cotasPendentes: [{ codigoCarteira: '20670' }] })
    expect(parcial).not.toHaveProperty('patrimonioLiquidoTotal')
  })

  it('so consolida as tres cotas e soma seus PLs com precisao decimal', () => {
    const resultado = conferir(respostaCompleta())
    expect(resultado).toMatchObject({ estado: 'COMPLETA', patrimonioLiquidoTotal: '100.4234', dataReferencia, cnpjFundo })
    if (resultado.estado !== 'COMPLETA') throw new Error('Esperada carteira completa')
    expect(resultado.cotas.map(cota => cota.patrimonioLiquido)).toEqual(['0.1000', '0.2000', '100.1234'])
    expect(resultado.configuracaoSnapshot).toEqual(configuracao)
  })

  it('nao entrega PL parcial quando so Junior e Mezza estao disponiveis', () => {
    const resultado = conferir([{ carteiras: [header('QA-J'), header('QA-M')] }])
    expect(resultado).toEqual({
      estado: 'AGUARDANDO_COTAS', dataReferencia,
      cotasDisponiveis: configuracao.cotas.slice(0, 2), cotasPendentes: configuracao.cotas.slice(2),
    })
    expect(resultado).not.toHaveProperty('patrimonioLiquidoTotal')
    expect(JSON.stringify(resultado)).not.toContain('100.00')
  })

  it.each(['08', '18'])('nao presume completude pelo horario %sh', hora => {
    vi.useFakeTimers().setSystemTime(new Date(`2026-10-20T${hora}:00:00-03:00`))
    expect(conferir([{ carteiras: [header('QA-J'), header('QA-M')] }]).estado).toBe('AGUARDANDO_COTAS')
  })

  it.each([[], [{ carteiras: [] }]].map(resposta => ({ resposta })))('resposta vazia nao comprova carteira completa: %j', ({ resposta }) => {
    expect(conferir(resposta)).toEqual({ estado: 'AGUARDANDO_COTAS', dataReferencia, cotasDisponiveis: [], cotasPendentes: configuracao.cotas })
  })

  it('reavalia a mesma data com a terceira cota, sem carregar PLs de outra consulta', () => {
    const primeira = conferir([{ carteiras: [header('QA-J'), header('QA-M')] }])
    expect(primeira.estado).toBe('AGUARDANDO_COTAS')
    expect(conferir([{ carteiras: [header('QA-S')] }]).estado).toBe('AGUARDANDO_COTAS')
    expect(conferir(respostaCompleta()).estado).toBe('COMPLETA')
  })

  it('soma apenas headers, nao os PLs repetidos nos ativos nem passivos', () => {
    const resposta = respostaCompleta().map(grupo => ({ ...grupo,
      ativos: [{ RendaFixa: { plTotal: 1000, ativos: [{ curvaAtual: 1000 }] } }],
      passivos: [{ pl: 2000 }],
    }))
    expect(conferir(resposta)).toMatchObject({ estado: 'COMPLETA', patrimonioLiquidoTotal: '100.4234' })
  })

  it('nao usa nomes, ordem do retorno ou labels como identificadores', () => {
    const resposta = respostaCompleta()[0].carteiras.reverse().map(cota => ({ ...cota, nome: 'Nome igual em todas' }))
    expect(conferir([{ carteiras: resposta }])).toEqual(conferir(respostaCompleta()))
  })

  it('permite headers distribuidos entre grupos, cada codigo uma unica vez', () => {
    expect(conferir(respostaCompleta()[0].carteiras.map(cota => ({ carteiras: [cota] })))).toEqual(conferir(respostaCompleta()))
  })

  it.each([true, false])('recusa codigo repetido mesmo com PL %s igual', igual => {
    const resposta = respostaCompleta()
    resposta.push({ carteiras: [header('QA-J', igual ? '0.10' : '999.00')] })
    expect(conferir(resposta)).toEqual(revisar('COTA_DUPLICADA'))
  })

  it('recusa cota adicional desconhecida em vez de omiti-la ou inclui-la silenciosamente', () => {
    const resposta = respostaCompleta()
    resposta[0].carteiras.push(header('QA-OUTRA'))
    expect(conferir(resposta)).toEqual(revisar('COTA_INESPERADA'))
  })

  it('isola o Fundo mesmo se codigo da cota for igual', () => {
    const resposta = respostaCompleta()
    resposta[0].carteiras[2].cnpjFundo = '99999999000199'
    expect(conferir(resposta)).toEqual(revisar('FUNDO_DIVERGENTE'))
  })

  it('aceita somente documento no formato conhecido, normalizando a pontuacao', () => {
    const resposta = respostaCompleta()
    resposta[0].carteiras.forEach(cota => { cota.cnpjFundo = '12.345.678/0001-90' })
    expect(conferir(resposta).estado).toBe('COMPLETA')
    resposta[0].carteiras[0].cnpjFundo = `prefixo-${cnpjFundo}`
    expect(conferir(resposta)).toEqual(revisar('RESPOSTA_INVALIDA'))
  })

  it('nao mistura cota de outra data com a data pedida', () => {
    const resposta = respostaCompleta()
    resposta[0].carteiras[2].dataAtual = '2026-10-16T03:00:00.000Z'
    expect(conferir(resposta)).toEqual(revisar('DATA_DIVERGENTE'))
  })

  it.each(['2026-02-30T03:00:00.000Z', 'ontem', '2026-10-19Tgarbage'])('nega data invalida %s', value => {
    const resposta = respostaCompleta()
    resposta[0].carteiras[2].dataAtual = value
    expect(conferir(resposta)).toEqual(revisar('RESPOSTA_INVALIDA'))
  })

  it.each(['Inativa', 'Pendente', ''])('nao considera disponivel um header com status %s', status => {
    const resposta = respostaCompleta()
    resposta[0].carteiras[2].status = status
    expect(conferir(resposta)).toEqual(revisar('COTA_INATIVA'))
  })

  it.each(['-1', '1,00', '1.000,00', 'NaN', 'Infinity', '1e3', '1.00001', '', ' 1.00 ', '10000000000000000.0000'])('nega PL invalido/ambiguo %j sem arredondar', pl => {
    const resposta = respostaCompleta()
    resposta[0].carteiras[2].pl = pl
    expect(conferir(resposta)).toEqual(revisar('PL_INVALIDO'))
  })

  it('aceita numeros JSON dentro do limite de precisao', () => {
    expect(conferir([{ carteiras: [header('QA-J', 0.1), header('QA-M', 0.2), header('QA-S', 1)] }])).toMatchObject({ estado: 'COMPLETA', patrimonioLiquidoTotal: '1.3000' })
  })

  it('rejeita numero JSON grande cuja precisao ja pode ter sido perdida', () => {
    expect(conferir([{ carteiras: [header('QA-J'), header('QA-M'), header('QA-S', 1000000000000.1234)] }])).toEqual(revisar('PL_INVALIDO'))
  })

  it('rejeita overflow no total mesmo quando cada parcela e representavel', () => {
    expect(conferir([{ carteiras: configuracao.cotas.map(cota => header(cota.codigoCarteira, '9999999999999999.9999')) }])).toEqual(revisar('PL_INVALIDO'))
  })

  it('permite PL zero em uma cota, mas nao publica consolidado zero', () => {
    expect(conferir([{ carteiras: [header('QA-J', '0'), header('QA-M', '0'), header('QA-S', '1')] }])).toMatchObject({ estado: 'COMPLETA', patrimonioLiquidoTotal: '1.0000' })
    expect(conferir([{ carteiras: configuracao.cotas.map(cota => header(cota.codigoCarteira, '0')) }])).toEqual(revisar('PL_INVALIDO'))
  })

  it.each([null, undefined])('sem roster explicito nao infere cotas pelo retorno', configuracao => {
    expect(conferirCompletudeCarteiraVortx({ cnpjFundo, dataReferencia, configuracao, resposta: respostaCompleta() })).toEqual({ estado: 'CONFIGURACAO_PENDENTE' })
  })

  it.each([
    {}, { versao: 1, cotas: [] }, { ...configuracao, versao: 2 },
    { versao: 1, cotas: [configuracao.cotas[0], configuracao.cotas[0]] },
    { versao: 1, cotas: [{ codigoCarteira: 'QA-J', rotulo: '' }] },
    { ...configuracao, totalEsperado: 3 },
  ])('rejeita roster invalido sem fallback: %j', config => {
    expect(conferir(respostaCompleta(), config)).toEqual(revisar('CONFIGURACAO_INVALIDA'))
    expect(configuracaoCarteiraConsolidadaSchema.safeParse(config).success).toBe(false)
  })

  it.each([{}, null, '[]', [{ carteiras: [{ carteira: 'QA-J' }] }], { statusHttp: 200, resposta: '[]' }].map(value => ({ value })))('nao aceita payload incompleto ou DTO de diagnostico: %j', ({ value }) => {
    expect(conferir(value)).toEqual(revisar('RESPOSTA_INVALIDA'))
  })

  it('nega contexto arbitrario antes de avaliar a resposta', () => {
    for (const contexto of [{ cnpjFundo: 'outro', dataReferencia }, { cnpjFundo, dataReferencia: '2026-02-30' }]) {
      expect(conferirCompletudeCarteiraVortx({ ...contexto, configuracao, resposta: respostaCompleta() })).toEqual(revisar('CONTEXTO_INVALIDO'))
    }
  })

  it('nao altera entrada nem a precisao Decimal global e gera resultado deterministico', () => {
    const resposta = respostaCompleta()
    const antes = JSON.stringify({ resposta, configuracao })
    const precisao = Decimal.precision
    const primeiro = conferir(resposta)
    expect(conferir(resposta)).toEqual(primeiro)
    expect(JSON.stringify({ resposta, configuracao })).toBe(antes)
    expect(Decimal.precision).toBe(precisao)
    if (primeiro.estado === 'COMPLETA') primeiro.configuracaoSnapshot.cotas[0].rotulo = 'Alterado'
    expect(configuracao.cotas[0].rotulo).toBe('Junior')
  })
})
