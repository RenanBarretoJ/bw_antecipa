import { describe, expect, it } from 'vitest'
import { resolverEndpointRemessaPortalFidc } from './endpoint-remessa'

describe('endpoint SOAP de envio Portal FIDC / Sinqia', () => {
  it.each([
    'https://provider.example/servicos/soap',
    'https://provider.example/servicos/soap/',
    ' https://provider.example/servicos/soap/ ',
    'https://provider.example/servicos/soap/importacaoArquivoRemessa',
    'https://provider.example/servicos/soap/importacaoArquivoRemessa/',
    'https://provider.example/servicos/soap/importacaoArquivoRemessa?wsdl',
    'https://provider.example/servicos/soap/importacaoArquivoRemessa?WSDL',
    'https://provider.example/servicos/soap/?wsdl',
  ])('resolve base ou WSDL sem duplicar o servico: %s', (input) => {
    const expected = 'https://provider.example/servicos/soap/importacaoArquivoRemessa'
    expect(resolverEndpointRemessaPortalFidc(input)).toBe(expected)
    expect(resolverEndpointRemessaPortalFidc(expected)).toBe(expected)
  })

  it('preserva prefixo de contexto, host, porta e parametros alheios ao WSDL', () => {
    expect(resolverEndpointRemessaPortalFidc('https://other-provider.example:8443/portal-servicos/servicos/soap/?tenant=qa&wsdl'))
      .toBe('https://other-provider.example:8443/portal-servicos/servicos/soap/importacaoArquivoRemessa?tenant=qa')
  })

  it.each([
    'https://custom.example/proxy/importacao?cliente=qa',
    'https://custom.example/servico?wsdl',
    'https://custom.example/servicos/soapOutro/',
  ])('nao inventa caminho para endpoints personalizados: %s', (input) => {
    expect(resolverEndpointRemessaPortalFidc(input)).toBe(input)
  })

  it.each(['', 'nao-e-url', '/servicos/soap/', 'http://provider.example/servicos/soap/',
    'https://usuario:segredo@provider.example/servicos/soap/', 'https://provider.example/servicos/soap/#fragmento'])
  ('rejeita configuracao invalida sem expor seu conteudo: %s', (input) => {
    expect(() => resolverEndpointRemessaPortalFidc(input)).toThrowError(expect.objectContaining({ categoria: 'configuracao' }))
    try { resolverEndpointRemessaPortalFidc(input) } catch (error) {
      expect(String(error)).not.toContain('segredo')
    }
  })
})
