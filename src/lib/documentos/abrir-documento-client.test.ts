import { afterEach, describe, expect, it, vi } from 'vitest'
import { abrirDocumentoAutorizado } from './abrir-documento-client'

afterEach(() => vi.unstubAllGlobals())

describe('ações do arquivo autorizado', () => {
  const preparar = () => {
    const open = vi.fn()
    vi.stubGlobal('window', { location: { origin: 'https://qa.example.invalid' }, open })
    return open
  }
  it('visualiza sem alterar a capacidade temporária ou impor download', () => {
    const open = preparar()
    abrirDocumentoAutorizado('https://qa.example.invalid/arquivo.pdf?token=qa-token', 'visualizar', 'termo.pdf')
    expect(open).toHaveBeenCalledWith('https://qa.example.invalid/arquivo.pdf?token=qa-token', '_blank', 'noopener,noreferrer')
  })
  it('solicita download com nome seguro e preserva o token existente', () => {
    const open = preparar()
    abrirDocumentoAutorizado('https://qa.example.invalid/arquivo.pdf?token=qa-token', 'baixar', '../termo?.pdf')
    const destino = new URL(open.mock.calls[0][0])
    expect(destino.searchParams.get('token')).toBe('qa-token')
    expect(destino.searchParams.get('download')).toBe('termo_.pdf')
  })
  it.each(['javascript:alert(1)', 'data:text/html,documento'])('rejeita protocolo não documental: %s', url => {
    const open = preparar()
    expect(() => abrirDocumentoAutorizado(url, 'visualizar', 'termo.pdf')).toThrow('Link do documento inválido.')
    expect(open).not.toHaveBeenCalled()
  })
  it('preserva o nome canônico definido pelo endpoint autorizado em vez do rótulo da interface', () => {
    const open = preparar()
    const nome = 'TERMO_CESSAO_FIDC_HEALTH_90C3DF7C.PDF'
    abrirDocumentoAutorizado(`https://qa.example.invalid/arquivo.pdf?token=qa-token&download=${nome}`, 'baixar', 'Termo de Cessao.pdf')
    const destino = new URL(open.mock.calls[0][0])
    expect(destino.searchParams.get('token')).toBe('qa-token')
    expect(destino.searchParams.get('download')).toBe(nome)
  })
})
