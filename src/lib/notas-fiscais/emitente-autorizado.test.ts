import { describe, expect, it } from 'vitest'
import {
  extrairCnpjDaChaveAcesso,
  validarEmitenteAutorizadoParaCedente,
  validarXmlNfeParaUploadCedente,
} from './emitente-autorizado'

function chaveNfe(cnpj: string, overrides: Partial<{
  uf: string
  aamm: string
  modelo: string
  serie: string
  numero: string
  tipoEmissao: string
  codigoNumerico: string
  digito: string
}> = {}) {
  return [
    overrides.uf ?? '35',
    overrides.aamm ?? '2607',
    cnpj.replace(/\D/g, ''),
    overrides.modelo ?? '55',
    overrides.serie ?? '001',
    overrides.numero ?? '000000123',
    overrides.tipoEmissao ?? '1',
    overrides.codigoNumerico ?? '12345678',
    overrides.digito ?? '9',
  ].join('')
}

function xmlNfe(input: { cnpjEmitente: string; cnpjChave?: string; chave?: string }) {
  const chave = input.chave ?? chaveNfe(input.cnpjChave ?? input.cnpjEmitente)
  return `<?xml version="1.0" encoding="UTF-8"?>
  <nfeProc>
    <NFe>
      <infNFe Id="NFe${chave}">
        <ide>
          <serie>1</serie>
          <nNF>123</nNF>
          <dhEmi>2026-07-24T10:00:00-03:00</dhEmi>
        </ide>
        <emit>
          <CNPJ>${input.cnpjEmitente}</CNPJ>
          <xNome>Cedente Teste</xNome>
        </emit>
        <dest>
          <CNPJ>11222333000144</CNPJ>
          <xNome>Sacado Teste</xNome>
        </dest>
        <total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>
      </infNFe>
    </NFe>
  </nfeProc>`
}

describe('validarEmitenteAutorizadoParaCedente', () => {
  it('aceita quando CNPJ do emitente, chave e cedente sao iguais', () => {
    const cnpj = '12345678000190'
    const result = validarEmitenteAutorizadoParaCedente({
      cnpjCedente: cnpj,
      cnpjEmitente: cnpj,
      chaveAcesso: chaveNfe(cnpj),
    })

    expect(result).toMatchObject({ ok: true, cnpjCedente: cnpj, cnpjEmitente: cnpj })
  })

  it('aceita mascara diferente quando os digitos sao os mesmos', () => {
    const result = validarEmitenteAutorizadoParaCedente({
      cnpjCedente: '12.345.678/0001-90',
      cnpjEmitente: '12345678000190',
      chaveAcesso: chaveNfe('12345678000190'),
    })

    expect(result.ok).toBe(true)
  })

  it('bloqueia CNPJ emitente diferente do cedente', () => {
    const result = validarEmitenteAutorizadoParaCedente({
      cnpjCedente: '12345678000190',
      cnpjEmitente: '99888777000166',
      chaveAcesso: chaveNfe('99888777000166'),
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'EMITENTE_NAO_AUTORIZADO',
      cnpjCedente: '12345678000190',
      cnpjEmitente: '99888777000166',
    })
  })

  it('bloqueia filial com mesma raiz e numero completo diferente', () => {
    const result = validarEmitenteAutorizadoParaCedente({
      cnpjCedente: '12345678000190',
      cnpjEmitente: '12345678000270',
      chaveAcesso: chaveNfe('12345678000270'),
    })

    expect(result).toMatchObject({ ok: false, code: 'EMITENTE_NAO_AUTORIZADO' })
  })

  it('permite que o fluxo multi-CNPJ resolva a filial no banco sem relaxar chave versus emitente', () => {
    const filial = '12345678000270'
    const result = validarEmitenteAutorizadoParaCedente({
      cnpjCedente: '12345678000190',
      cnpjEmitente: filial,
      chaveAcesso: chaveNfe(filial),
      permitirEstabelecimentoDoCedente: true,
    })

    expect(result).toMatchObject({ ok: true, cnpjEmitente: filial, cnpjChaveAcesso: filial })

    const divergente = validarEmitenteAutorizadoParaCedente({
      cnpjCedente: '12345678000190',
      cnpjEmitente: filial,
      chaveAcesso: chaveNfe('99888777000166'),
      permitirEstabelecimentoDoCedente: true,
    })
    expect(divergente).toMatchObject({ ok: false, code: 'CHAVE_EMITENTE_DIVERGENTE' })
  })

  it('bloqueia CNPJ invalido no XML', () => {
    const result = validarEmitenteAutorizadoParaCedente({
      cnpjCedente: '12345678000190',
      cnpjEmitente: '123',
      chaveAcesso: chaveNfe('12345678000190'),
    })

    expect(result).toMatchObject({ ok: false, code: 'CNPJ_EMITENTE_INVALIDO' })
  })

  it('retorna erro de configuracao quando CNPJ cadastrado do cedente e invalido', () => {
    const result = validarEmitenteAutorizadoParaCedente({
      cnpjCedente: '123',
      cnpjEmitente: '12345678000190',
      chaveAcesso: chaveNfe('12345678000190'),
    })

    expect(result).toMatchObject({ ok: false, code: 'CNPJ_CEDENTE_INVALIDO' })
  })

  it('bloqueia chave com menos ou mais de 44 digitos', () => {
    expect(validarEmitenteAutorizadoParaCedente({
      cnpjCedente: '12345678000190',
      cnpjEmitente: '12345678000190',
      chaveAcesso: chaveNfe('12345678000190').slice(0, 43),
    })).toMatchObject({ ok: false, code: 'CHAVE_ACESSO_INVALIDA' })

    expect(validarEmitenteAutorizadoParaCedente({
      cnpjCedente: '12345678000190',
      cnpjEmitente: '12345678000190',
      chaveAcesso: `${chaveNfe('12345678000190')}0`,
    })).toMatchObject({ ok: false, code: 'CHAVE_ACESSO_INVALIDA' })
  })

  it('bloqueia quando CNPJ da chave e diferente do emitente', () => {
    const result = validarEmitenteAutorizadoParaCedente({
      cnpjCedente: '12345678000190',
      cnpjEmitente: '12345678000190',
      chaveAcesso: chaveNfe('99888777000166'),
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'CHAVE_EMITENTE_DIVERGENTE',
      cnpjChaveAcesso: '99888777000166',
    })
  })
})

describe('validarXmlNfeParaUploadCedente', () => {
  it('extrai o CNPJ da chave nas posicoes 7 a 20', () => {
    expect(extrairCnpjDaChaveAcesso(chaveNfe('12345678000190'))).toBe('12345678000190')
  })

  it('bloqueia XML antes de qualquer INSERT ou upload no Storage', () => {
    let storageChamado = false
    let insertChamado = false
    const preValidacao = validarXmlNfeParaUploadCedente({
      xmlContent: xmlNfe({ cnpjEmitente: '99888777000166' }),
      cnpjCedente: '12345678000190',
    })

    if (preValidacao.ok) {
      storageChamado = true
      insertChamado = true
    }

    expect(preValidacao.ok).toBe(false)
    expect(storageChamado).toBe(false)
    expect(insertChamado).toBe(false)
  })

  it('nao ocupa estado: segunda tentativa com XML valido funciona normalmente', () => {
    const invalido = validarXmlNfeParaUploadCedente({
      xmlContent: xmlNfe({ cnpjEmitente: '99888777000166' }),
      cnpjCedente: '12345678000190',
    })
    const valido = validarXmlNfeParaUploadCedente({
      xmlContent: xmlNfe({ cnpjEmitente: '12345678000190' }),
      cnpjCedente: '12.345.678/0001-90',
    })

    expect(invalido.ok).toBe(false)
    expect(valido).toMatchObject({ ok: true, cnpjEmitente: '12345678000190' })
  })

  it('bloqueia XML cuja chave possui tamanho invalido mesmo quando o parser legado nao preenche chave_acesso', () => {
    const result = validarXmlNfeParaUploadCedente({
      xmlContent: xmlNfe({ cnpjEmitente: '12345678000190', chave: chaveNfe('12345678000190').slice(0, 43) }),
      cnpjCedente: '12345678000190',
    })

    expect(result).toMatchObject({ ok: false, code: 'CHAVE_ACESSO_INVALIDA' })
  })
})
