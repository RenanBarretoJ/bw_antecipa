import { afterEach, describe, expect, it, vi } from 'vitest'
import { baixarArquivoFiscal, lerArquivoLimitado, nomeDownloadSeguro } from './arquivo-fiscal-client'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('leitura e download de bytes fiscais', () => {
  it('preserva os bytes e MIME originais, inclusive bytes não textuais', async () => {
    const bytes = new Uint8Array([0, 1, 128, 255])
    const blob = await lerArquivoLimitado(new Response(bytes, { headers: { 'content-type': 'application/pdf' } }), 4)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
    expect(blob.type).toBe('application/pdf')
  })
  it.each([401, 403, 404, 500])('não salva páginas de erro HTTP %s como documento', async status => {
    await expect(lerArquivoLimitado(new Response('erro', { status }), 10)).rejects.toThrow('indisponível')
  })
  it('aborta resposta que excede o limite informado no header', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ cancel })
    await expect(lerArquivoLimitado(new Response(body, { headers: { 'content-length': '100' } }), 10)).rejects.toThrow('limite')
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('impõe limite mesmo sem header ou com tamanho declarado falso', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(11)) }, cancel })
    await expect(lerArquivoLimitado(new Response(body, { headers: { 'content-length': '1' } }), 10)).rejects.toThrow('limite')
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('rejeita corpo vazio sem iniciar download', async () => {
    await expect(lerArquivoLimitado(new Response(''), 10)).rejects.toThrow('vazio')
  })
  it.each([['../../nota.xml', 'nota.xml'], ['C:\\pasta\\nota.pdf', 'nota.pdf'], ['../', 'arquivo'], ['..', 'arquivo'], ['nota\r\n.pdf', 'nota__.pdf']])('remove caminho e controles do nome %s', (input, expected) => {
    expect(nomeDownloadSeguro(input)).toBe(expected)
  })
  it('usa download do navegador, mantém bytes e libera o Blob URL', async () => {
    vi.useFakeTimers()
    const click = vi.fn(), remove = vi.fn(), append = vi.fn()
    const link = { href: '', download: '', click, remove }
    vi.stubGlobal('document', { createElement: vi.fn(() => link), body: { append } })
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-qa')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => new Response('<xml/>', { headers: { 'content-type': 'application/xml' } }))
    vi.stubGlobal('fetch', fetchMock)
    await baixarArquivoFiscal('https://example.invalid/transient', 'nota.xml')
    expect(fetchMock).toHaveBeenCalledWith('https://example.invalid/transient', { credentials: 'omit' })
    expect(link.download).toBe('nota.xml'); expect(click).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce()
    const saved = create.mock.calls[0][0]
    if (!(saved instanceof Blob)) throw new Error('expected original Blob')
    expect(await saved.text()).toBe('<xml/>')
    expect(revoke).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1000)
    expect(revoke).toHaveBeenCalledWith('blob:local-qa')
  })
})
