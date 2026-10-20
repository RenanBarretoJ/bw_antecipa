import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createServer, request, type RequestOptions, type Server } from 'node:https'
import type { Duplex } from 'node:stream'
import type { TLSSocket } from 'node:tls'
import type { IncomingMessage } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { postJsonMtls } from './mtls-http-client.server'
import { solicitarRelatorioVortxHttp } from './relatorios-http.server'

// Local-only functional proof: ephemeral CA/server/client, no provider credentials.
// The injected request maps the fixed provider destination to loopback and adds
// ONLY the test CA. Server verification and client-certificate checks stay on.
describe('Vortx reports: real mTLS on loopback', () => {
  let directory: string | undefined, server: Server | undefined, port: number
  let ca: string, cert: string, key: string
  const sockets = new Set<Duplex>()
  const received: Array<{ authorized: boolean; method?: string; path?: string; bearer?: string; body: unknown }> = []
  const protocol = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 0, dataSolicitacao: '2026-10-19T17:00:00Z' }

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'bw-vortx-mtls-test-'))
    const run = (...args: string[]) => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore', timeout: 15000, windowsHide: true })
    const emptyConfig = process.platform === 'win32' ? 'NUL' : '/dev/null'
    run('req', '-config', emptyConfig, '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=BW-Synthetic-Test-CA', '-addext', 'basicConstraints=critical,CA:TRUE')
    for (const name of ['server', 'client']) {
      run('req', '-config', emptyConfig, '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name === 'server' ? 'localhost' : 'BW-Synthetic-Client'}`,
        '-addext', name === 'server' ? 'subjectAltName=DNS:localhost,IP:127.0.0.1' : 'extendedKeyUsage=clientAuth')
      run('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${name}.pem`, '-days', '2', '-copy_extensions', 'copy')
    }
    const read = (file: string) => readFileSync(join(directory!, file), 'utf8')
    ca = read('ca.pem'); cert = read('client.pem'); key = read('client.key')
    server = createServer({ key: read('server.key'), cert: read('server.pem'), ca, requestCert: true, rejectUnauthorized: true }, (req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        received.push({ authorized: (req.socket as TLSSocket).authorized, method: req.method, path: req.url,
          bearer: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: protocol }))
      })
    })
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('TEST_SERVER_NOT_LOOPBACK')
    port = address.port
  }, 60000)

  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    if (server) {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    }
    if (directory) {
      const resolved = realpathSync(directory)
      if (dirname(resolved) !== realpathSync(tmpdir()) || !basename(resolved).startsWith('bw-vortx-mtls-test-')) throw new Error('INVALID_TEST_CLEANUP_TARGET')
      rmSync(resolved, { recursive: true })
    }
  })

  const localRequest = (change: Partial<RequestOptions> = {}) => vi.fn((options: RequestOptions, callback: (res: IncomingMessage) => void) =>
    request({ ...options, hostname: '127.0.0.1', port, servername: 'localhost', ca, ...change }, callback))

  it('accepts exactly one POST with trusted client cert + Bearer and a complete report protocol', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const transport = localRequest()
    const pedido = { codigoCarteira: 'qa-carteira', tipoRelatorio: 'PosicaoParcela' as const,
      dataInicio: '2020-01-01', dataFim: '2020-01-31', dataReferencia: '2020-01-31', extensaoArquivo: 2 as const }
    const before = received.length
    const result = await solicitarRelatorioVortxHttp({ ambiente: 'producao', token: 'synthetic-bearer', pedido,
      credential: { certificadoPem: cert, chavePrivadaPem: key } }, transport as unknown as typeof request)
    expect(result).toEqual({ estado: 'aceita', protocolo: protocol.id, http: 200 })
    expect(received.slice(before)).toEqual([{ authorized: true, method: 'POST', path: '/v1/vrs/externo/solicitar', bearer: 'Bearer synthetic-bearer', body: pedido }])
    expect(transport).toHaveBeenCalledOnce()
    expect(transport.mock.calls[0][0]).toMatchObject({ hostname: 'api.vortx.com.br', rejectUnauthorized: true, agent: false })
  })

  it('missing client certificate fails the TLS handshake with zero HTTP requests', async () => {
    const before = received.length
    const transport = localRequest({ cert: undefined, key: undefined })
    await expect(postJsonMtls({ baseUrl: 'https://api.vortx.com.br', path: '/v1/vrs/externo/solicitar', body: {},
      credential: { certificadoPem: cert, chavePrivadaPem: key }, totalTimeoutMs: 3000 }, transport as unknown as typeof request)).rejects.toMatchObject({ categoria: 'conexao', httpStatus: null })
    expect(received).toHaveLength(before)
    expect(transport).toHaveBeenCalledOnce()
  })

  it('untrusted server is rejected without disabling server verification or sending HTTP', async () => {
    const before = received.length
    const transport = localRequest({ ca: undefined })
    await expect(postJsonMtls({ baseUrl: 'https://api.vortx.com.br', path: '/v1/vrs/externo/solicitar', body: {},
      credential: { certificadoPem: cert, chavePrivadaPem: key }, totalTimeoutMs: 3000 }, transport as unknown as typeof request)).rejects.toMatchObject({ categoria: 'conexao', httpStatus: null })
    expect(received).toHaveLength(before)
    expect(transport).toHaveBeenCalledOnce()
  })
})
