import { EventEmitter } from 'node:events'
import type { request as httpsRequest } from 'node:https'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { baixarRelatorioVortx, ipPublicoParaRelatorio, MAX_REPORT_BYTES, validarUrlDownloadRelatorio } from './relatorios-download.server'

const host = 'reports.example.invalid', hosts = [host], signed = `https://${host}/private.csv?signature=synthetic-secret`
class Reply extends EventEmitter {
  complete = true; statusCode = 200; destroyed = false
  headers: Record<string, string | undefined> = { 'content-type': 'application/octet-stream' }
  destroy() { this.destroyed = true }
}
function transport(change: Partial<Reply> = {}, chunks: Buffer[] = [Buffer.from('synthetic-csv')]) {
  const response = Object.assign(new Reply(), change)
  const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() })
  const fn = vi.fn((_options: unknown, callback: (reply: Reply) => void) => {
    queueMicrotask(() => {
      callback(response)
      for (const chunk of chunks) response.emit('data', chunk)
      response.emit('end')
    })
    return req
  })
  return { response, req, fn, deps: { request: fn as unknown as typeof httpsRequest,
    resolver: vi.fn().mockResolvedValue([{ address: '52.95.1.1', family: 4 }]) } }
}
afterEach(() => vi.useRealTimers())
describe('signed report download isolation and bounds', () => {
  it.each(['http://reports.example.invalid/a', 'https://127.0.0.1/a', 'https://reports.example.invalid.evil/a',
    'https://user:pass@reports.example.invalid/a', 'https://reports.example.invalid:444/a',
    'https://reports.example.invalid/a#fragment', 'https://other.example.invalid/a'])('rejects unapproved URL before DNS/HTTP: %s', async url => {
    const test = transport()
    await expect(baixarRelatorioVortx(url, hosts, test.deps)).rejects.toMatchObject({ codigo: 'HOST_NEGADO' })
    expect(test.fn).not.toHaveBeenCalled(); expect(test.deps.resolver).not.toHaveBeenCalled()
  })
  it('never interprets a wildcard as hostname authorization', () => {
    expect(() => validarUrlDownloadRelatorio(signed, ['*.example.invalid'])).toThrow('HOST_NEGADO')
  })
  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '192.168.1.1', '172.16.0.1',
    '0.0.0.0', '192.0.2.1', '198.18.0.1', '224.1.1.1', '255.255.255.255', '::1', '::ffff:127.0.0.1',
    'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::', '3fff::1', 'not-an-ip'])('rejects non-public destination %s', address => {
    expect(ipPublicoParaRelatorio(address)).toBe(false)
  })
  it('rejects mixed public/private DNS answers rather than selecting the convenient one', async () => {
    const test = transport(); test.deps.resolver.mockResolvedValue([{ address: '52.95.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }])
    await expect(baixarRelatorioVortx(signed, hosts, test.deps)).rejects.toMatchObject({ codigo: 'DNS_NEGADO' })
    expect(test.fn).not.toHaveBeenCalled()
  })
  it('pins the numeric connection while preserving TLS identity, without provider credentials', async () => {
    const test = transport()
    expect(Buffer.from(await baixarRelatorioVortx(signed, hosts, test.deps)).toString()).toBe('synthetic-csv')
    expect(test.deps.resolver).toHaveBeenCalledOnce()
    expect(test.fn.mock.calls[0][0]).toEqual({ method: 'GET', hostname: '52.95.1.1', family: 4,
      servername: host, port: 443, path: '/private.csv?signature=synthetic-secret', agent: false, rejectUnauthorized: true,
      headers: { Host: host, Accept: 'text/csv,application/octet-stream,text/plain', 'Accept-Encoding': 'identity' } })
  })
  it.each([301, 302, 307, 401, 403, 404, 500, 206])('rejects HTTP %i without following or retrying', async statusCode => {
    const test = transport({ statusCode })
    await expect(baixarRelatorioVortx(signed, hosts, test.deps)).rejects.toMatchObject({ codigo: 'DOWNLOAD_HTTP' })
    expect(test.fn).toHaveBeenCalledOnce(); expect(test.response.destroyed).toBe(true)
  })
  it.each([
    { headers: { 'content-type': 'text/html' } }, { headers: { 'content-type': 'text/csv', 'content-encoding': 'gzip' } },
    { headers: { 'content-type': 'text/csv', 'content-length': '999' } },
    { headers: { 'content-type': 'text/csv', 'content-length': String(MAX_REPORT_BYTES + 1) } }, { complete: false },
  ])('rejects unexpected content, framing or truncation: %j', async change => {
    const test = transport(change)
    await expect(baixarRelatorioVortx(signed, hosts, test.deps)).rejects.toMatchObject({ codigo: 'CONTEUDO_INVALIDO' })
  })
  it('enforces a streaming 20 MiB limit even without Content-Length', async () => {
    const test = transport({}, [Buffer.alloc(MAX_REPORT_BYTES + 1)])
    await expect(baixarRelatorioVortx(signed, hosts, test.deps)).rejects.toMatchObject({ codigo: 'CONTEUDO_INVALIDO' })
    expect(test.req.destroy).toHaveBeenCalled()
  })
  it('accepts exactly 20 MiB in bounded chunks', async () => {
    const test = transport({}, [Buffer.alloc(10 * 1024 * 1024), Buffer.alloc(10 * 1024 * 1024)])
    expect((await baixarRelatorioVortx(signed, hosts, test.deps)).byteLength).toBe(MAX_REPORT_BYTES)
  })
  it('rejects an empty HTTP 200', async () => {
    const test = transport({}, [])
    await expect(baixarRelatorioVortx(signed, hosts, test.deps)).rejects.toMatchObject({ codigo: 'CONTEUDO_INVALIDO' })
  })
  it('never leaks a DNS exception containing a URL/token', async () => {
    const test = transport(); test.deps.resolver.mockRejectedValue(new Error(signed))
    await expect(baixarRelatorioVortx(signed, hosts, test.deps)).rejects.toThrow('DNS_NEGADO')
  })
  it('bounds a stalled DNS resolution', async () => {
    vi.useFakeTimers()
    const test = transport(); test.deps.resolver.mockReturnValue(new Promise(() => {}))
    const operation = baixarRelatorioVortx(signed, hosts, test.deps)
    const assertion = expect(operation).rejects.toMatchObject({ codigo: 'DOWNLOAD_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(5000); await assertion
    expect(test.fn).not.toHaveBeenCalled()
  })
  it('bounds the entire HTTP response, not merely idle socket time', async () => {
    vi.useFakeTimers()
    const test = transport()
    test.fn.mockImplementation(() => test.req) // The server never completes a response.
    const operation = baixarRelatorioVortx(signed, hosts, test.deps)
    const assertion = expect(operation).rejects.toMatchObject({ codigo: 'DOWNLOAD_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(60000); await assertion
    expect(test.req.destroy).toHaveBeenCalled()
  })
  it('classifies an unsupported provider format without exporting headers or bytes', async () => {
    const test = transport({ headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } })
    await expect(baixarRelatorioVortx(signed, hosts, test.deps)).rejects.toMatchObject({ codigo: 'CONTEUDO_INVALIDO', diagnostico: { http: 200, conteudo: 'XLSX' } })
  })
})
