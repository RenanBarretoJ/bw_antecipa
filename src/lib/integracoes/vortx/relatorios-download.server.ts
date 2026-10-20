import 'server-only'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { MAX_REPORT_BYTES, extrairCsvZipVortx } from './relatorios-zip.server'

export { MAX_REPORT_BYTES } from './relatorios-zip.server'
const transportCodes = ['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH',
  'EHOSTUNREACH', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']
const transportCode = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error
  && typeof error.code === 'string' && transportCodes.includes(error.code) ? error.code : 'OUTRO'
type DownloadDiagnostic = { http?: number; conteudo?: 'CSV' | 'TEXTO' | 'BINARIO' | 'ZIP' | 'XLSX' | 'HTML' | 'JSON' | 'OUTRO'; transporte?: string }
export class DownloadRelatorioError extends Error {
  constructor(readonly codigo: 'HOST_NEGADO' | 'DNS_NEGADO' | 'DOWNLOAD_TIMEOUT' | 'DOWNLOAD_HTTP' | 'CONTEUDO_INVALIDO' | 'DOWNLOAD_FALHOU',
    readonly diagnostico: DownloadDiagnostic = {}) {
    super(codigo); this.name = 'DownloadRelatorioError'
  }
}
const blocked = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['192.88.99.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) {
  blocked.addSubnet(address, prefix, 'ipv4')
}
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6')
blocked.addSubnet('2001::', 23, 'ipv6'); blocked.addSubnet('2001:db8::', 32, 'ipv6')
blocked.addSubnet('2002::', 16, 'ipv6'); blocked.addSubnet('3fff::', 20, 'ipv6')
export function ipPublicoParaRelatorio(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? !blocked.check(address, 'ipv4') : family === 6
    ? globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6') : false
}

export function validarUrlDownloadRelatorio(raw: string, hosts: readonly string[]): URL {
  try {
    const url = new URL(raw)
    if (raw.length > 8192 || url.protocol !== 'https:' || url.username || url.password || url.hash
      || (url.port && url.port !== '443') || isIP(url.hostname) || !hosts.includes(url.hostname)
      || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(url.hostname)) throw new Error()
    return url
  } catch { throw new DownloadRelatorioError('HOST_NEGADO') }
}

type Address = { address: string; family: number }
type Dependencies = { resolver?: (host: string) => Promise<Address[]>; request?: typeof httpsRequest }

/** Signed GET only: exact hosts, pinned public DNS, normal TLS, no redirects/retries,
 * no VRS bearer/mTLS/cookies, no decompression. Errors never include the signed URL.
 */
export async function baixarRelatorioVortx(raw: string, hosts: readonly string[], deps: Dependencies = {}): Promise<Uint8Array> {
  const url = validarUrlDownloadRelatorio(raw, hosts)
  let dnsTimer: ReturnType<typeof setTimeout> | undefined
  let addresses: Address[]
  try {
    addresses = await Promise.race([
      (deps.resolver ?? (host => lookup(host, { all: true, verbatim: true })))(url.hostname),
      new Promise<never>((_, reject) => { dnsTimer = setTimeout(() => reject(new DownloadRelatorioError('DOWNLOAD_TIMEOUT')), 5000) }),
    ])
  } catch (error) { throw error instanceof DownloadRelatorioError ? error : new DownloadRelatorioError('DNS_NEGADO', { transporte: transportCode(error) }) }
  finally { clearTimeout(dnsTimer) }
  if (!addresses.length || addresses.some(value => !ipPublicoParaRelatorio(value.address)
    || isIP(value.address) !== value.family)) throw new DownloadRelatorioError('DNS_NEGADO')
  const pinned = addresses[0]
  // Connect to the validated numeric address, but retain original TLS identity and Host.
  // This removes the second DNS lookup/rebinding opportunity altogether.
  const options: RequestOptions = { method: 'GET', hostname: pinned.address, family: pinned.family,
    servername: url.hostname, port: 443, path: url.pathname + url.search, agent: false, rejectUnauthorized: true,
    headers: { Host: url.hostname, Accept: 'text/csv,application/octet-stream,text/plain', 'Accept-Encoding': 'identity' } }
  return new Promise((resolve, reject) => {
    let req: ClientRequest | undefined, response: IncomingMessage | undefined, settled = false
    const fail = (codigo: DownloadRelatorioError['codigo'], transporte?: string) => {
      if (settled) return
      const mime = response?.headers['content-type']?.split(';')[0].trim().toLowerCase()
      const conteudo: DownloadDiagnostic['conteudo'] = mime === 'text/csv' || mime === 'application/csv' ? 'CSV'
        : mime === 'text/plain' ? 'TEXTO' : ['application/octet-stream', 'binary/octet-stream'].includes(mime ?? '') ? 'BINARIO'
          : mime === 'application/zip' ? 'ZIP' : mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ? 'XLSX'
            : mime === 'text/html' ? 'HTML' : mime === 'application/json' ? 'JSON' : 'OUTRO'
      settled = true; clearTimeout(timer); reject(new DownloadRelatorioError(codigo,
        { ...(response ? { http: response.statusCode, conteudo } : {}), ...(transporte ? { transporte } : {}) })); response?.destroy(); req?.destroy()
    }
    const timer = setTimeout(() => fail('DOWNLOAD_TIMEOUT'), 60000)
    try {
      req = (deps.request ?? httpsRequest)(options, res => {
        response = res
        if (settled) { res.destroy(); return }
        res.on('error', () => fail('DOWNLOAD_FALHOU'))
        res.on('aborted', () => fail('CONTEUDO_INVALIDO'))
        res.on('close', () => { if (!settled && !res.complete) fail('CONTEUDO_INVALIDO') })
        if (res.statusCode !== 200) { fail('DOWNLOAD_HTTP'); return }
        const mime = res.headers['content-type']?.split(';')[0].trim().toLowerCase()
        const encoding = res.headers['content-encoding']
        const length = res.headers['content-length']
        if (!mime || !['text/csv', 'application/csv', 'text/plain', 'application/octet-stream', 'binary/octet-stream', 'application/zip'].includes(mime)
          || (encoding && encoding !== 'identity') || (length && (!/^\d+$/.test(length) || Number(length) > MAX_REPORT_BYTES))) {
          fail('CONTEUDO_INVALIDO'); return
        }
        const chunks: Buffer[] = []; let bytes = 0
        res.on('data', (chunk: Buffer) => {
          if (settled) return
          bytes += chunk.length
          if (bytes > MAX_REPORT_BYTES) { fail('CONTEUDO_INVALIDO'); return }
          chunks.push(chunk)
        })
        res.on('end', async () => {
          if (settled) return
          if (!res.complete || !bytes || (length && Number(length) !== bytes)) { fail('CONTEUDO_INVALIDO'); return }
          const body = Buffer.concat(chunks, bytes)
          const isZip = body.length >= 4 && body.readUInt32LE(0) === 0x04034b50
          if (mime === 'application/zip' && !isZip) { fail('CONTEUDO_INVALIDO'); return }
          try {
            const csv = isZip ? await extrairCsvZipVortx(body) : body
            if (settled) return
            settled = true; clearTimeout(timer); resolve(csv)
          } catch { fail('CONTEUDO_INVALIDO') }
        })
      })
      req.on('error', error => fail('DOWNLOAD_FALHOU', transportCode(error))); req.end()
    } catch (error) { fail('DOWNLOAD_FALHOU', transportCode(error)) }
  })
}
