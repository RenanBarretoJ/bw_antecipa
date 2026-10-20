import { afterEach, describe, expect, it, vi } from 'vitest'
import { concluirUploadDocumentoAssinado, enviarDocumentoAssinado } from './upload-documento-assinado'

afterEach(() => vi.unstubAllGlobals())
const pdf = new File(['%PDF-1.7\n'], 'contrato.pdf', { type: 'application/pdf' })

describe('confirmacao do contrato assinado', () => {
  it('aguarda a persistencia antes de confirmar', async () => {
    const ordem: string[] = []
    const path = await concluirUploadDocumentoAssinado(async () => {
      ordem.push('upload'); return 'privado.pdf'
    }, async () => { await Promise.resolve(); ordem.push('salvo') })
    ordem.push('sucesso')
    expect(path).toBe('privado.pdf')
    expect(ordem).toEqual(['upload', 'salvo', 'sucesso'])
  })
  it('propaga falha do callback sem confirmar sucesso', async () => {
    await expect(concluirUploadDocumentoAssinado(async () => 'privado.pdf', async () => {
      throw new Error('persistencia falhou')
    })).rejects.toThrow('persistencia falhou')
  })
  it('nao chama callback se o upload falhar', async () => {
    const callback = vi.fn()
    await expect(concluirUploadDocumentoAssinado(async () => { throw new Error('upload') }, callback)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled()
  })
  it('envia somente arquivo ao endpoint autenticado, sem path/fundo/bucket', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ path: 'privado.pdf' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await enviarDocumentoAssinado('/api/cedentes/qa/contrato-assinado', pdf)).toBe('privado.pdf')
    const [endpoint, init] = fetchMock.mock.calls[0]
    expect(endpoint).toBe('/api/cedentes/qa/contrato-assinado')
    expect(init.method).toBe('POST')
    expect([...init.body.keys()]).toEqual(['arquivo'])
  })
  it('nao considera HTTP 200 sem path como sucesso', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})))
    await expect(enviarDocumentoAssinado('/api/qa', pdf)).rejects.toThrow('Não foi possível salvar')
  })
  it('preserva mensagem de dominio da API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Confirme o MFA.' }, { status: 403 })))
    await expect(enviarDocumentoAssinado('/api/qa', pdf)).rejects.toThrow('Confirme o MFA.')
  })
  it('nao exibe HTML de erro do proxy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('internal SQL stack', { status: 413 })))
    await expect(enviarDocumentoAssinado('/api/qa', pdf)).rejects.toThrow('Não foi possível salvar')
  })
})
