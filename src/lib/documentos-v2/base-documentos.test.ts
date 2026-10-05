import { describe, expect, it } from 'vitest'
import { validarDocumentoBaseDaNota, validarDocumentoBaseDaNotaComDadosDanfe, validarDocumentoBaseDaNotaComDadosXml } from './base-documentos'
import { validateMunicipalVisual } from '@/lib/nfse/municipal-visual-contract'
import { municipalFixture } from '@/lib/nfse/fixtures/municipal'

const referencia = {
  chaveAcesso: '41260500262371000575550010000131911836000001',
  numero: '13191',
  serie: '1',
  cnpjEmitente: '00.262.371/0005-75',
  cnpjDestinatario: '40.439.661/0001-32',
}

describe('documentos-base da NF', () => {
  it('matches municipal PDF by issuer, recipient, number, authority and verification code', async () => {
    const parsedNfse = validateMunicipalVisual(municipalFixture())
    const fiscalProveniencia = {strategy: 'nfse_municipal_visual', orgao_emissor: parsedNfse.dados.orgao_emissor,
      codigo_verificacao: parsedNfse.dados.codigo_verificacao}
    const input = { codigo: 'nf_danfe_pdf', arquivo: new File(['qa'], 'qa.pdf'), parsedNfse,
      referencia: {tipoDocumentoFiscal: 'NFSE' as const, chaveAcesso:null, numero:'1234', serie:null,
        cnpjEmitente:parsedNfse.dados.cnpj_emitente!, cnpjDestinatario:parsedNfse.dados.cnpj_destinatario!, fiscalProveniencia}}
    expect((await validarDocumentoBaseDaNota(input))?.chaveAcesso).toBeNull()
    for (const field of ['orgao_emissor','codigo_verificacao','strategy']) {
      await expect(validarDocumentoBaseDaNota({...input, referencia:{...input.referencia,
        fiscalProveniencia:{...fiscalProveniencia,[field]:'OTHER'}}})).rejects.toThrow('Identidade municipal')
    }
    await expect(validarDocumentoBaseDaNota({...input, referencia:{...input.referencia,chaveAcesso:'1'.repeat(50)}})).rejects.toThrow('Identidade municipal')
  })
  it('aceita XML da mesma NF e do mesmo emitente', () => {
    const xml = `<nfeProc><NFe><infNFe Id="NFe${referencia.chaveAcesso}"><ide><nNF>${referencia.numero}</nNF><serie>${referencia.serie}</serie><dhEmi>2026-05-18T10:00:00-03:00</dhEmi></ide><emit><CNPJ>00262371000575</CNPJ><xNome>FORMAPLAN</xNome></emit><dest><CNPJ>40439661000132</CNPJ><xNome>SPE PAUPINA</xNome></dest><total><ICMSTot><vNF>5974.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`
    expect(validarDocumentoBaseDaNotaComDadosXml({ xml, referencia }).codigo).toBe('nf_xml')
  })

  it('rejeita XML da mesma NF quando o destinatario diverge', () => {
    const xml = `<NFe><infNFe Id="NFe${referencia.chaveAcesso}"><ide><nNF>${referencia.numero}</nNF><serie>${referencia.serie}</serie></ide><emit><CNPJ>00262371000575</CNPJ></emit><dest><CNPJ>11111111000111</CNPJ></dest></infNFe></NFe>`
    expect(() => validarDocumentoBaseDaNotaComDadosXml({ xml, referencia })).toThrow('destinatario')
  })

  it('aceita DANFE identificado pela mesma chave', () => {
    expect(validarDocumentoBaseDaNotaComDadosDanfe({
      referencia,
      parsed: {
        chave_acesso: referencia.chaveAcesso,
        numero_nf: referencia.numero,
        serie: referencia.serie,
        cnpj_destinatario: referencia.cnpjDestinatario.replace(/\D/g, ''),
        campos_extraidos: ['chave_acesso', 'numero_nf', 'serie'],
      },
    }).codigo).toBe('nf_danfe_pdf')
  })

  it('reutiliza o DANFE prevalidado sem reler o PDF apos o primeiro upload no Storage', async () => {
    const arquivo = { arrayBuffer: () => { throw new Error('PDF relido indevidamente') } } as unknown as File
    const resultado = await validarDocumentoBaseDaNota({
      codigo: 'nf_danfe_pdf',
      arquivo,
      referencia,
      parsedDanfe: { chave_acesso: referencia.chaveAcesso, numero_nf: referencia.numero, serie: referencia.serie, campos_extraidos: ['chave_acesso', 'numero_nf', 'serie'] },
    })
    expect(resultado?.codigo).toBe('nf_danfe_pdf')
  })

  it('rejeita PDF identificado como outra NF', () => {
    expect(() => validarDocumentoBaseDaNotaComDadosDanfe({
      referencia,
      parsed: { numero_nf: '99999', campos_extraidos: ['numero_nf'] },
    })).toThrow('numero da NF')
  })

  it('rejeita PDF sem identificacao suficiente para ser DANFE', () => {
    expect(() => validarDocumentoBaseDaNotaComDadosDanfe({
      referencia,
      parsed: { campos_extraidos: [] },
    })).toThrow('nao foi reconhecido como DANFE')
  })
})
