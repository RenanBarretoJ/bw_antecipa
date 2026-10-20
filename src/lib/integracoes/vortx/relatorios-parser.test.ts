import { describe, expect, it } from 'vitest'
import { CONTEXTO_CSV_QA, csvVortxQa, relatorioVortxQa } from './__fixtures__/relatorios-csv'
import { normalizarStatusEntradaVortx, TIPOS_CSV_VORTX, type TipoCsvVortx } from './relatorios-layout'
import { processarCsvRelatorioVortx } from './relatorios-parser'

describe('parser nativo Vortx, sem persistencia', () => {
  it.each(TIPOS_CSV_VORTX)('le o layout %s, preserva bruto e valores em strings', (tipo) => {
    const resultado = relatorioVortxQa(tipo)
    expect(resultado.completo).toBe(true)
    expect(resultado.linhas[0].dadosBrutos['Valor de Compra']).toBe('90.00')
    expect(resultado.linhas[0].dadosNormalizados.valor_aquisicao).toBe('90.0000')
    expect(resultado.versaoLayout).toBe('VORTX_RELATORIOS_CSV_V1')
    expect(resultado.hashArquivo).toMatch(/^[a-f0-9]{64}$/)
  })

  it('preserva chaves longas, acentos, espacamento bruto e BOM', () => {
    const chave = '91000000000000000000000000000000002'
    const csv = csvVortxQa('PosicaoAtivo', [{ chave_ativo: chave, cedente_nome: 'Empresa; com "aspas"', status_entrada_provedor: '  Em trânsito  ' }])
    const arquivo = new TextEncoder().encode('\uFEFF' + new TextDecoder().decode(csv))
    const result = processarCsvRelatorioVortx({ arquivo, tipoRelatorio: 'PosicaoAtivo', contexto: CONTEXTO_CSV_QA })
    expect(result.completo).toBe(true)
    expect(result.linhas[0].dadosNormalizados.chave_ativo).toBe(chave)
    expect(result.linhas[0].dadosBrutos['Campo Customizado 2']).toBe('  Em trânsito  ')
    expect(result.linhas[0].dadosNormalizados.status_entrada_provedor).toBe('EM_TRANSITO')
    expect(result.linhas[0].dadosNormalizados.cedente_nome).toBe('Empresa; com "aspas"')
  })

  it('chaves iguais de cedentes diferentes nao sao removidas ou misturadas', () => {
    const result = relatorioVortxQa('PosicaoParcela', [{}, { cedente_documento: '98992300000441' }])
    expect(result.completo).toBe(true)
    expect(result.linhas).toHaveLength(2)
    expect(new Set(result.linhas.map((row) => row.dadosNormalizados.external_title_key)).size).toBe(2)
  })

  it('identidade da parcela coincide entre inclusao e estoque', () => {
    expect(relatorioVortxQa('Inclusao').linhas[0].dadosNormalizados.external_title_key)
      .toBe(relatorioVortxQa('PosicaoParcela').linhas[0].dadosNormalizados.external_title_key)
  })

  it('preserva zeros de CPF e normaliza documento formatado sem criar outra identidade', () => {
    const result = relatorioVortxQa('PosicaoParcela', [{ sacado_documento: '01234567890', cedente_documento: '98.992.300/0002-80' }])
    expect(result.completo).toBe(true)
    expect(result.linhas[0].dadosNormalizados.sacado_documento).toBe('01234567890')
    expect(result.linhas[0].dadosNormalizados.external_title_key)
      .toBe(relatorioVortxQa('PosicaoParcela').linhas[0].dadosNormalizados.external_title_key)
  })

  it.each([
    { fundoId: 'c4cfda85-b7cf-4f10-9db3-095820d73906' }, { ambiente: 'producao' as const },
  ])('identidade inclui Fundo e ambiente: %j', (patch) => {
    const base = relatorioVortxQa('PosicaoParcela').linhas[0].dadosNormalizados.external_title_key
    const outro = relatorioVortxQa('PosicaoParcela', [{}], { ...CONTEXTO_CSV_QA, ...patch })
    expect(outro.linhas[0].dadosNormalizados.external_title_key).not.toBe(base)
  })

  it('carteiras distintas nao compartilham identidade', () => {
    const outro = relatorioVortxQa('PosicaoParcela', [{ codigo_carteira: 'OUTRA' }], { ...CONTEXTO_CSV_QA, codigoCarteira: 'OUTRA' })
    expect(outro.completo).toBe(true)
    expect(outro.linhas[0].dadosNormalizados.external_title_key)
      .not.toBe(relatorioVortxQa('PosicaoParcela').linhas[0].dadosNormalizados.external_title_key)
  })

  it.each(TIPOS_CSV_VORTX)('rejeita repeticao dentro do mesmo escopo em %s sem eliminar linhas', (tipo) => {
    const result = relatorioVortxQa(tipo, [{}, {}])
    expect(result.completo).toBe(false)
    expect(result.linhas).toHaveLength(2)
    expect(result.linhas.every((row) => row.erros.includes('IDENTIDADE_DUPLICADA_NO_ESCOPO'))).toBe(true)
  })

  it('permite movimentos em dias distintos dentro do periodo, sem forcar todos para D-1', () => {
    const result = relatorioVortxQa('Inclusao', [{ data_movimento: '15/10/2026' }, { data_movimento: '16/10/2026' }])
    expect(result.completo).toBe(true)
    expect(result.linhas.map((row) => row.dadosNormalizados.data_movimento)).toEqual(['2026-10-15', '2026-10-16'])
    expect(relatorioVortxQa('Inclusao', [{ data_movimento: '14/10/2026' }]).completo).toBe(false)
  })

  const patchesInvalidos: Record<string, string>[] = [
    { codigo_carteira: 'OUTRO-FUNDO' }, { cedente_documento: '123' }, { sacado_documento: 'abc98992300000360' },
    { chave_parcela: '' }, { valor_aquisicao: '90,00' }, { valor_nominal: '1.000' },
    { valor_presente: '1e3' }, { data_emissao: '31/02/2026' }, { data_vencimento: '2026-02-30' },
    { status_entrada_provedor: 'Liquidado' },
  ]
  it.each(patchesInvalidos)('marca a linha invalida sem expor valores na mensagem: %j', (patch) => {
    const result = relatorioVortxQa('PosicaoParcela', [patch])
    expect(result.completo).toBe(false)
    expect(result.linhas[0].status).toBe('INVALIDA')
    expect(result.linhas[0].erros.length).toBeGreaterThan(0)
  })

  it('nao preenche valor ausente com zero nem status inicial com entregue', () => {
    const row = relatorioVortxQa('PosicaoParcela', [{ valor_pdd: '' }]).linhas[0]
    expect(row.dadosNormalizados.valor_pdd).toBe('')
    expect(row.dadosNormalizados.status_entrada_provedor).toBe('NAO_INFORMADO')
    expect(row.avisos).toContain('STATUS_ENTRADA_NAO_INFORMADO')
  })

  it('data de pagamento igual ao vencimento nao vira liquidacao ou status gerencial', () => {
    const row = relatorioVortxQa('PosicaoParcela', [{ data_pagamento_informada: '20/11/2026' }]).linhas[0]
    expect(row.dadosNormalizados.data_pagamento_informada).toBe('2026-11-20')
    expect(row.dadosNormalizados).not.toHaveProperty('liquidado')
    expect(row.dadosNormalizados).not.toHaveProperty('status_logistico')
  })

  it.each([
    (value: string) => value.replace('"Código da Carteira"', '"Campo desconhecido"'),
    (value: string) => value.replace('"Código da Carteira"', '"CPF/CNPJ do Cedente"'),
    (value: string) => value.split('\r\n')[0],
    (value: string) => value + 'colunas;incompletas\r\n',
  ])('rejeita drift de schema, cabecalho duplicado ou CSV incompleto', (change) => {
    const arquivo = new TextEncoder().encode(change(new TextDecoder().decode(csvVortxQa('Inclusao'))))
    expect(() => processarCsvRelatorioVortx({ arquivo, tipoRelatorio: 'Inclusao', contexto: CONTEXTO_CSV_QA })).toThrow()
  })

  it('nao inventa layout de exclusao nem aceita UTF-8 quebrado ou arquivo acima do limite', () => {
    for (const arquivo of [new Uint8Array(), new Uint8Array([0xff]), new Uint8Array(20 * 1024 * 1024 + 1)]) {
      expect(() => processarCsvRelatorioVortx({ arquivo, tipoRelatorio: 'Inclusao', contexto: CONTEXTO_CSV_QA })).toThrow()
    }
    expect(() => processarCsvRelatorioVortx({ arquivo: csvVortxQa('Inclusao'), tipoRelatorio: 'Exclusao' as TipoCsvVortx, contexto: CONTEXTO_CSV_QA }))
      .toThrow(expect.objectContaining({ codigo: 'CONTEXTO_INVALIDO' }))
  })

  it('rejeita contexto malformado sem mudar o payload original', () => {
    const arquivo = csvVortxQa('Inclusao'), copia = arquivo.slice()
    expect(() => processarCsvRelatorioVortx({ arquivo, tipoRelatorio: 'Inclusao', contexto: { ...CONTEXTO_CSV_QA, fundoId: 'outro' } })).toThrow()
    expect(arquivo).toEqual(copia)
  })

  it('interrompe antes da normalizacao quando o CSV supera 100 mil linhas', () => {
    const header = new TextDecoder().decode(csvVortxQa('Inclusao')).split('\r\n')[0]
    const arquivo = new TextEncoder().encode(header + '\n' + '1;1;1;1;1;1;1;1;1;1\n'.repeat(100_001))
    expect(() => processarCsvRelatorioVortx({ arquivo, tipoRelatorio: 'Inclusao', contexto: CONTEXTO_CSV_QA }))
      .toThrow(expect.objectContaining({ codigo: 'LINHAS_INVALIDAS' }))
  })

  it.each([['Em trânsito', 'EM_TRANSITO'], [' ENTREGUE ', 'ENTREGUE'], ['', 'NAO_INFORMADO']])('normaliza %s para %s', (value, expected) => {
    expect(normalizarStatusEntradaVortx(value)).toBe(expected)
  })
})
