import { describe, expect, it } from 'vitest'
import { parseNFeXML } from './nf-parser'

// Cenario real do ticket: NF-e 78, 4 parcelas de R$ 27.540,00, total R$ 110.160,00.
function montarXmlComParcelas(dups: Array<{ nDup: string; dVenc: string; vDup: string }>) {
  const dupTags = dups.map((d) => `<dup><nDup>${d.nDup}</nDup><dVenc>${d.dVenc}</dVenc><vDup>${d.vDup}</vDup></dup>`).join('')
  return `<nfeProc><NFe><infNFe Id="NFe35260800000000000000550010000000781000000078">
    <ide><nNF>78</nNF><serie>1</serie><dhEmi>2026-09-10T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>11444777000161</CNPJ><xNome>Emitente Teste</xNome></emit>
    <dest><CNPJ>11444777000161</CNPJ><xNome>Destinatario Teste</xNome></dest>
    <det><prod><xProd>Produto Teste</xProd><qCom>1</qCom><vProd>110160.00</vProd></prod></det>
    <cobr>${dupTags}</cobr>
    <total><ICMSTot><vNF>110160.00</vNF><vICMS>0</vICMS><vIPI>0</vIPI><vPIS>0</vPIS><vCOFINS>0</vCOFINS></ICMSTot></total>
    <pag><detPag><tPag>15</tPag></detPag></pag>
  </infNFe></NFe></nfeProc>`
}

describe('parseNFeXML: extracao de parcelas (<cobr><dup>)', () => {
  it('extrai as 4 parcelas da NF-e 78 (numero, vencimento, valor) sem descartar nDup/vDup', () => {
    const xml = montarXmlComParcelas([
      { nDup: '001', dVenc: '2026-10-11', vDup: '27540.00' },
      { nDup: '002', dVenc: '2026-10-26', vDup: '27540.00' },
      { nDup: '003', dVenc: '2026-11-10', vDup: '27540.00' },
      { nDup: '004', dVenc: '2026-11-25', vDup: '27540.00' },
    ])
    const parsed = parseNFeXML(xml)

    expect(parsed.parcelas).toHaveLength(4)
    expect(parsed.parcelas).toEqual([
      { numero_parcela: 1, data_vencimento: '2026-10-11', valor_nominal: 27540 },
      { numero_parcela: 2, data_vencimento: '2026-10-26', valor_nominal: 27540 },
      { numero_parcela: 3, data_vencimento: '2026-11-10', valor_nominal: 27540 },
      { numero_parcela: 4, data_vencimento: '2026-11-25', valor_nominal: 27540 },
    ])

    const soma = parsed.parcelas.reduce((total, p) => total + p.valor_nominal, 0)
    expect(soma).toBeCloseTo(110160, 2)
  })

  it('vencimento agregado da NF continua sendo o da ultima <dup> (compatibilidade preservada)', () => {
    const xml = montarXmlComParcelas([
      { nDup: '001', dVenc: '2026-10-11', vDup: '27540.00' },
      { nDup: '004', dVenc: '2026-11-25', vDup: '27540.00' },
    ])
    const parsed = parseNFeXML(xml)
    expect(parsed.data_vencimento).toBe('2026-11-25')
  })

  it('NF sem <dup> nao gera parcelas (comportamento legado preservado)', () => {
    const xml = montarXmlComParcelas([])
    const parsed = parseNFeXML(xml)
    expect(parsed.parcelas).toEqual([])
    expect(parsed.data_vencimento).toBe('')
  })

  it('NF com 1 unica <dup> gera exatamente 1 parcela', () => {
    const xml = montarXmlComParcelas([{ nDup: '001', dVenc: '2026-10-11', vDup: '110160.00' }])
    const parsed = parseNFeXML(xml)
    expect(parsed.parcelas).toEqual([{ numero_parcela: 1, data_vencimento: '2026-10-11', valor_nominal: 110160 }])
  })

  it('usa a posicao como numero_parcela quando nDup nao e numerico', () => {
    const xml = montarXmlComParcelas([
      { nDup: 'A', dVenc: '2026-10-11', vDup: '55080.00' },
      { nDup: 'B', dVenc: '2026-11-10', vDup: '55080.00' },
    ])
    const parsed = parseNFeXML(xml)
    expect(parsed.parcelas.map((p) => p.numero_parcela)).toEqual([1, 2])
  })
})
