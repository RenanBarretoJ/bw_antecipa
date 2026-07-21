import { describe, expect, it } from 'vitest'
import { parseCteXml } from './cte-parser'

const xmlValido = `<?xml version="1.0" encoding="UTF-8"?>
<cteProc>
  <CTe>
    <infCte Id="CTe35260412345678000190570010000012341000012345">
      <ide>
        <nCT>1234</nCT>
        <serie>1</serie>
        <dhEmi>2026-04-10T10:00:00-03:00</dhEmi>
      </ide>
      <emit><CNPJ>12345678000190</CNPJ></emit>
      <rem><CNPJ>11111111000191</CNPJ></rem>
      <dest><CNPJ>22222222000192</CNPJ></dest>
      <vPrest><vTPrest>150.75</vTPrest></vPrest>
      <infDoc><infNFe><chave>31260412345678000190550010000045671000045678</chave></infNFe></infDoc>
    </infCte>
  </CTe>
</cteProc>`

describe('parseCteXml', () => {
  it('extrai dados estruturais e NFs referenciadas de um CT-e XML', async () => {
    const result = await parseCteXml(new File([xmlValido], 'cte.xml', { type: 'application/xml' }))

    expect(result.valido).toBe(true)
    expect(result.chave_cte).toBe('35260412345678000190570010000012341000012345')
    expect(result.numero).toBe('1234')
    expect(result.serie).toBe('1')
    expect(result.data_emissao).toBe('2026-04-10')
    expect(result.cnpj_transportadora).toBe('12345678000190')
    expect(result.cnpj_remetente).toBe('11111111000191')
    expect(result.cnpj_destinatario).toBe('22222222000192')
    expect(result.valor_frete).toBe(150.75)
    expect(result.chaves_nfe_referenciadas).toEqual(['31260412345678000190550010000045671000045678'])
  })

  it('rejeita XML sem NF-e referenciada', async () => {
    const semNfe = xmlValido.replace('<infNFe><chave>31260412345678000190550010000045671000045678</chave></infNFe>', '')
    const result = await parseCteXml(new File([semNfe], 'cte.xml', { type: 'application/xml' }))

    expect(result.valido).toBe(false)
    expect(result.erros.join(' ')).toMatch(/NF-e referenciada/i)
  })
})
