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

// Ticket P0/P1 NF de Remessa como lastro logistico: a NF de remessa
// referencia a venda via <NFref><refNFe> e precisa de itens/quantidade
// estruturados para o matching de saldo (regra D do ticket).
describe('parseNFeXML: itens estruturados, quantidade total e NFref (NF de Remessa)', () => {
  function montarXmlComItensERef(opts: { itens: Array<{ cProd: string; xProd: string; qCom: string; uCom: string; vProd: string; ncm?: string }>; refNFe?: string[]; infCpl?: string }) {
    const detTags = opts.itens
      .map((item) => `<det><prod><cProd>${item.cProd}</cProd><xProd>${item.xProd}</xProd>${item.ncm ? `<NCM>${item.ncm}</NCM>` : ''}<qCom>${item.qCom}</qCom><uCom>${item.uCom}</uCom><vProd>${item.vProd}</vProd></prod></det>`)
      .join('')
    const nfRefTags = (opts.refNFe || []).map((chave) => `<NFref><refNFe>${chave}</refNFe></NFref>`).join('')
    const infAdic = opts.infCpl ? `<infAdic><infCpl>${opts.infCpl}</infCpl></infAdic>` : ''
    return `<nfeProc><NFe><infNFe Id="NFe35260800000000000000550020000350061000000078">
      <ide><nNF>35006</nNF><serie>2</serie><dhEmi>2026-09-10T10:00:00-03:00</dhEmi></ide>
      ${nfRefTags}
      <emit><CNPJ>15644666000230</CNPJ><xNome>ZF LOG</xNome></emit>
      <dest><CNPJ>23704498000179</CNPJ><xNome>MJR REFRIGERACAO LTDA</xNome></dest>
      ${detTags}
      ${infAdic}
      <total><ICMSTot><vNF>3433.50</vNF><vICMS>0</vICMS><vIPI>0</vIPI><vPIS>0</vPIS><vCOFINS>0</vCOFINS></ICMSTot></total>
    </infNFe></NFe></nfeProc>`
  }

  it('extrai itens estruturados (codigo/ncm/descricao/quantidade/unidade/valor) de cada <det><prod>', () => {
    const xml = montarXmlComItensERef({
      itens: [{ cProd: '00000000042430', xProd: 'DAC R404 GB RLX 10,9KG ONU 3337 - CLASSE 2.2', qCom: '76.3000', uCom: 'CX', vProd: '3433.50', ncm: '38276100' }],
    })
    const parsed = parseNFeXML(xml)
    expect(parsed.itensEstruturados).toEqual([
      { descricao: 'DAC R404 GB RLX 10,9KG ONU 3337 - CLASSE 2.2', codigo: '00000000042430', ncm: '38276100', quantidade: 76.3, unidade: 'CX', valor: 3433.5 },
    ])
  })

  it('item sem <NCM> tem ncm como string vazia (compatibilidade)', () => {
    const xml = montarXmlComItensERef({
      itens: [{ cProd: '1', xProd: 'Produto sem NCM', qCom: '1', uCom: 'UN', vProd: '10' }],
    })
    const parsed = parseNFeXML(xml)
    expect(parsed.itensEstruturados[0].ncm).toBe('')
  })

  it('quantidadeTotal e a soma de qCom de todos os itens', () => {
    const xml = montarXmlComItensERef({
      itens: [
        { cProd: '1', xProd: 'Produto A', qCom: '10', uCom: 'UN', vProd: '100' },
        { cProd: '2', xProd: 'Produto B', qCom: '5.5', uCom: 'UN', vProd: '50' },
      ],
    })
    const parsed = parseNFeXML(xml)
    expect(parsed.quantidadeTotal).toBeCloseTo(15.5, 2)
  })

  it('NF sem <det> tem itensEstruturados vazio e quantidadeTotal zero (compatibilidade)', () => {
    const parsed = parseNFeXML(montarXmlComItensERef({ itens: [] }))
    expect(parsed.itensEstruturados).toEqual([])
    expect(parsed.quantidadeTotal).toBe(0)
    expect(parsed.descricao_itens).toBe('')
  })

  it('extrai a(s) chave(s) de <NFref><refNFe>, na ordem em que aparecem', () => {
    const chaveVenda = '13260707312248000307550040000055761611390985'
    const parsed = parseNFeXML(montarXmlComItensERef({ itens: [], refNFe: [chaveVenda] }))
    expect(parsed.nfRefChaves).toEqual([chaveVenda])
  })

  it('NF sem NFref tem nfRefChaves vazio (nao inventa vinculo)', () => {
    const parsed = parseNFeXML(montarXmlComItensERef({ itens: [] }))
    expect(parsed.nfRefChaves).toEqual([])
  })

  it('ignora chaves de NFref fora do formato de 44 digitos', () => {
    const parsed = parseNFeXML(montarXmlComItensERef({ itens: [], refNFe: ['123'] }))
    expect(parsed.nfRefChaves).toEqual([])
  })

  it('extrai infAdic/infCpl como evidencia complementar (nao substitui NFref)', () => {
    const parsed = parseNFeXML(montarXmlComItensERef({ itens: [], infCpl: 'Remessa referente a NF 5576' }))
    expect(parsed.evidenciaComplementar).toBe('Remessa referente a NF 5576')
  })
})
