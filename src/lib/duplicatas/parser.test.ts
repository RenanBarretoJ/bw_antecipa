import { describe, expect, it } from 'vitest'
import { extrairDuplicataDeTexto, normalizarTextoDuplicata } from './parser'

const PARTES = `
Cedente
COMERCIAL EXEMPLO LTDA
CNPJ 07.312.248/0003-07
Sacado
CLIENTE EXEMPLO S.A.
CNPJ 22.761.584/0011-22
`

describe('extracao deterministica de Duplicata Mercantil', () => {
  it('extrai numero com barra, parcela, valor brasileiro, datas e CNPJs mascarados', () => {
    const result = extrairDuplicataDeTexto(`
      Nº de Ordem: 13372/1
      Número da Fatura: 13372/1
      Data de emissão: 18/07/2026
      Vencimento: 17/08/2026
      Valor nominal: R$ 99.573,76
      ${PARTES}
      Praça de pagamento: São Paulo - SP
    `)

    expect(result.campos).toMatchObject({
      numero: '13372/1',
      numero_fatura: '13372/1',
      parcela: '1',
      data_emissao: '2026-07-18',
      data_vencimento: '2026-08-17',
      valor_nominal: 99573.76,
      nome_cedente_documento: 'COMERCIAL EXEMPLO LTDA',
      cnpj_cedente_documento: '07312248000307',
      nome_sacado_documento: 'CLIENTE EXEMPLO S.A.',
      cnpj_sacado_documento: '22761584001122',
      aceite_detectado_textualmente: 'INDETERMINADO',
    })
    expect(result.metodo).toBe('AUTOMATICA')
    expect(result.evidencias.numero?.trechoFonte).toContain('13372/1')
  })

  it('extrai numero simples e parcela informada em campo proprio', () => {
    const result = extrairDuplicataDeTexto(`
      Número da duplicata
      88442
      Parcela: 3
      Vencimento: 01/12/2026
      Valor do título: 1.250,00
      ${PARTES}
    `)
    expect(result.campos.numero).toBe('88442')
    expect(result.campos.parcela).toBe('3')
  })

  it('tolera rotulo e valor quebrados por linha', () => {
    const result = extrairDuplicataDeTexto(`
      Duplicata Nº
      4500/2
      Data de vencimento
      30/09/2026
      Valor da duplicata
      10.000,50
      ${PARTES}
    `)
    expect(result.campos.numero).toBe('4500/2')
    expect(result.campos.data_vencimento).toBe('2026-09-30')
    expect(result.campos.valor_nominal).toBe(10000.5)
  })

  it('prioriza candidato identificado por rotulo quando existem outros numeros', () => {
    const result = extrairDuplicataDeTexto(`
      Código interno 999999
      Número da duplicata: 12345/1
      Vencimento: 10/10/2026
      Valor nominal: 500,00
      ${PARTES}
    `)
    expect(result.campos.numero).toBe('12345/1')
  })

  it('registra apenas deteccao textual do aceite, sem afirmar validade juridica', () => {
    const present = extrairDuplicataDeTexto(`
      Número da duplicata: 12345/1
      Vencimento: 10/10/2026
      Valor nominal: 500,00
      Aceite: assinado pelo sacado
      ${PARTES}
    `)
    const absent = extrairDuplicataDeTexto(`
      Número da duplicata: 12345/2
      Vencimento: 11/10/2026
      Valor nominal: 500,00
      Aceite: não identificado
      ${PARTES}
    `)
    expect(present.campos.aceite_detectado_textualmente).toBe('SIM')
    expect(absent.campos.aceite_detectado_textualmente).toBe('NAO')
  })

  it('mantem campos ausentes como null e exige revisao', () => {
    const result = extrairDuplicataDeTexto('Documento mercantil sem campos estruturados, apenas texto descritivo suficientemente longo para leitura.')
    expect(result.campos.numero).toBeNull()
    expect(result.campos.valor_nominal).toBeNull()
    expect(result.metodo).toBe('MANUAL')
    expect(result.camposCriticosPendentes).toContain('numero')
  })

  it('encaminha PDF sem camada textual para preenchimento manual', () => {
    const result = extrairDuplicataDeTexto('   ')
    expect(result.metodo).toBe('MANUAL')
    expect(result.confiancaGeral).toBe(0)
    expect(result.textoExtraido).toBeNull()
  })

  it('rejeita datas civis inexistentes sem inventar normalizacao', () => {
    const result = extrairDuplicataDeTexto(`
      Número da duplicata: 123/1
      Vencimento: 31/02/2026
      Valor nominal: 100,00
      ${PARTES}
    `)
    expect(result.campos.data_vencimento).toBeNull()
    expect(result.camposCriticosPendentes).toContain('data_vencimento')
  })

  it('limita o texto persistivel a 50 mil caracteres', () => {
    expect(normalizarTextoDuplicata('A'.repeat(60_000))).toHaveLength(50_000)
  })
})
