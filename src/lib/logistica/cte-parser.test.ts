import { describe, expect, it } from 'vitest'
import { parseCteXml } from './cte-parser'

export const chaveNfeFixture = '41260500262371000575550010000131911937900007'
export const chaveCteFixture = '41260532595140000227570010000005451000005452'

export const cteXmlValido = `<?xml version="1.0" encoding="UTF-8"?>
<cteProc versao="4.00">
  <CTe>
    <infCte Id="CTe${chaveCteFixture}" versao="4.00">
      <ide>
        <cUF>41</cUF>
        <CFOP>5353</CFOP>
        <natOp>PRESTACAO DE SERVICO DE TRANSPORTE</natOp>
        <mod>57</mod>
        <serie>1</serie>
        <nCT>545</nCT>
        <dhEmi>2026-05-20T10:00:00-03:00</dhEmi>
        <tpAmb>2</tpAmb>
        <tpCTe>0</tpCTe>
        <tpServ>0</tpServ>
        <cMunIni>4106902</cMunIni>
        <xMunIni>CURITIBA</xMunIni>
        <UFIni>PR</UFIni>
        <cMunFim>3550308</cMunFim>
        <xMunFim>SAO PAULO</xMunFim>
        <UFFim>SP</UFFim>
        <modal>01</modal>
      </ide>
      <emit>
        <CNPJ>32595140000227</CNPJ>
        <IE>123456789</IE>
        <xNome>TRANSPORTADORA TESTE LTDA</xNome>
        <enderEmit><cMun>4106902</cMun><xMun>CURITIBA</xMun><UF>PR</UF></enderEmit>
      </emit>
      <rem>
        <CNPJ>00262371000575</CNPJ>
        <xNome>FORMAPLAN FORMAS PLANEJADAS</xNome>
        <enderReme><cMun>4106902</cMun><xMun>CURITIBA</xMun><UF>PR</UF></enderReme>
      </rem>
      <dest>
        <CNPJ>40439661000132</CNPJ>
        <xNome>SPE PAUPINA EMPREENDIMENTOS</xNome>
        <enderDest><cMun>3550308</cMun><xMun>SAO PAULO</xMun><UF>SP</UF></enderDest>
      </dest>
      <vPrest>
        <vTPrest>150.75</vTPrest>
        <vRec>150.75</vRec>
        <Comp><xNome>FRETE</xNome><vComp>150.75</vComp></Comp>
      </vPrest>
      <infCTeNorm>
        <infCarga>
          <vCarga>5974.00</vCarga>
          <proPred>formas metalicas</proPred>
          <infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>1000.0000</qCarga></infQ>
        </infCarga>
        <infDoc><infNFe><chave>${chaveNfeFixture}</chave></infNFe></infDoc>
      </infCTeNorm>
    </infCte>
  </CTe>
  <protCTe versao="4.00">
    <infProt>
      <tpAmb>2</tpAmb>
      <chCTe>${chaveCteFixture}</chCTe>
      <dhRecbto>2026-05-20T10:05:00-03:00</dhRecbto>
      <nProt>141260000000000</nProt>
      <digVal>abc</digVal>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso do CT-e</xMotivo>
    </infProt>
  </protCTe>
</cteProc>`

describe('parseCteXml', () => {
  it('extrai dados estruturais, fiscais e logisticos de um CT-e 4.00', async () => {
    const result = await parseCteXml(cteXmlValido)

    expect(result.valido).toBe(true)
    expect(result.chave_cte).toBe(chaveCteFixture)
    expect(result.chave_cte_protocolo).toBe(chaveCteFixture)
    expect(result.numero).toBe('545')
    expect(result.serie).toBe('1')
    expect(result.data_emissao).toBe('2026-05-20')
    expect(result.versao_layout).toBe('4.00')
    expect(result.modelo).toBe('57')
    expect(result.ambiente).toBe('2')
    expect(result.status_autorizacao).toBe('100')
    expect(result.cnpj_transportadora).toBe('32595140000227')
    expect(result.cnpj_remetente).toBe('00262371000575')
    expect(result.cnpj_destinatario).toBe('40439661000132')
    expect(result.transportadora.razao_social).toBe('TRANSPORTADORA TESTE LTDA')
    expect(result.valor_frete).toBe(150.75)
    expect(result.valor_carga).toBe(5974)
    expect(result.uf_origem).toBe('PR')
    expect(result.uf_destino).toBe('SP')
    expect(result.chaves_nfe_referenciadas).toEqual([chaveNfeFixture])
  })

  it('rejeita XML sem NF-e referenciada', async () => {
    const semNfe = cteXmlValido.replace(`<infDoc><infNFe><chave>${chaveNfeFixture}</chave></infNFe></infDoc>`, '')
    const result = await parseCteXml(semNfe)

    expect(result.valido).toBe(false)
    expect(result.erros.join(' ')).toMatch(/NF-e referenciada/i)
  })

  it('rejeita chave interna divergente do protocolo', async () => {
    const divergente = cteXmlValido.replace(`<chCTe>${chaveCteFixture}</chCTe>`, '<chCTe>41260532595140000227570010000005451000005453</chCTe>')
    const result = await parseCteXml(divergente)

    expect(result.valido).toBe(false)
    expect(result.erros.join(' ')).toMatch(/protocolo/i)
  })
})
