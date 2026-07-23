import { describe, expect, it } from 'vitest'
import { decidirAcaoDuplicidadeNotaFiscal, mensagemDuplicidadeNotaFiscal } from './upload-context'

describe('fluxo de upload de NF XML', () => {
  it('permite seguir quando a chave de acesso ainda nao existe', () => {
    expect(decidirAcaoDuplicidadeNotaFiscal({ existeNota: false, possuiXmlDocumentalValido: false }))
      .toBe('prosseguir')
  })

  it('retorna conflito quando a chave ja possui XML documental valido', () => {
    const acao = decidirAcaoDuplicidadeNotaFiscal({ existeNota: true, possuiXmlDocumentalValido: true })

    expect(acao).toBe('conflito_xml_existente')
    expect(mensagemDuplicidadeNotaFiscal(acao)).toBe('NF com chave de acesso ja cadastrada.')
  })

  it('classifica NF sem XML documental como registro incompleto recuperavel', () => {
    const acao = decidirAcaoDuplicidadeNotaFiscal({ existeNota: true, possuiXmlDocumentalValido: false })

    expect(acao).toBe('recuperar_registro_incompleto')
    expect(mensagemDuplicidadeNotaFiscal(acao)).toContain('registro incompleto sem XML')
  })
})
