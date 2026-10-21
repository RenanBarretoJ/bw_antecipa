import { EventEmitter } from 'node:events'
import type { request as httpsRequest, RequestOptions } from 'node:https'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { solicitarRelatorioVortxHttp } from './relatorios-http.server'
const pedido = { codigoCarteira: 'qa-carteira', tipoRelatorio: 'PosicaoParcela' as const, dataInicio:'2020-01-01', dataFim:'2020-01-31', dataReferencia:'2020-01-31', extensaoArquivo:2 as const }
const credential = { certificadoPem: 'synthetic-cert', chavePrivadaPem: 'synthetic-private-key' }
const input = { ambiente:'producao' as const, token:'opaque-qa-token', pedido, credential }
const protocol = { id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status:0, dataSolicitacao:'2026-10-19T17:00:00Z' }
class ResponseFixture extends EventEmitter {
  complete = true
  statusCode: number
  constructor(status: number) { super(); this.statusCode = status }
  destroy() { return this }
}
function transport(status: number, body: string, error?: Error) {
  const call = vi.fn((options: RequestOptions, callback: (res: ResponseFixture) => void) => {
    const req = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), destroy: vi.fn() })
    queueMicrotask(() => {
      if (error) { req.emit('error', error); return }
      const response = new ResponseFixture(status); callback(response)
      response.emit('data', Buffer.from(body)); response.emit('end')
    })
    return req
  })
  return { call, request: call as unknown as typeof httpsRequest }
}
beforeEach(() => { vi.spyOn(console, 'info').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })
describe('solicitação Vórtx: transporte de protocolo', () => {
  it.each(['producao','homologacao'] as const)('POST único no host fixo %s', async ambiente => {
    const { request, call } = transport(200, JSON.stringify({data:protocol}))
    expect(await solicitarRelatorioVortxHttp({...input,ambiente},request)).toEqual({estado:'aceita',protocolo:protocol.id,http:200})
    expect(call).toHaveBeenCalledTimes(1)
    const [options] = call.mock.calls[0]
    expect(options).toMatchObject({ method: 'POST', hostname: ambiente==='producao'?'api.vortx.com.br':'api-stg.vortx.com.br',
      path: '/v1/vrs/externo/solicitar', cert: credential.certificadoPem, key: credential.chavePrivadaPem,
      rejectUnauthorized: true, agent: false, timeout: 20000, headers: { authorization: 'Bearer opaque-qa-token' } })
    expect(call.mock.results[0].value.write).toHaveBeenCalledExactlyOnceWith(Buffer.from(JSON.stringify(pedido)))
  })
  it.each([400,401,403,404,405,415,422,429])('HTTP %s é recusa, sem expor corpo ou repetir', async http => {
    const {request,call}=transport(http,'Bearer segredo-real')
    const result=await solicitarRelatorioVortxHttp(input,request)
    expect(result).toEqual({estado:'recusada',protocolo:null,http});expect(JSON.stringify(result)).not.toContain('segredo-real');expect(call).toHaveBeenCalledTimes(1)
  })
  it.each([301,302,307,500,502,503])('HTTP %s é inconclusivo, sem redirect/retry', async http => {
    const {request,call}=transport(http,'privado')
    expect(await solicitarRelatorioVortxHttp(input,request)).toEqual({estado:'indeterminada',protocolo:null,http});expect(call).toHaveBeenCalledTimes(1)
  })
  it.each(['', '[]', '{}', '<html>segredo</html>', JSON.stringify({...protocol,status:1}), JSON.stringify({data:protocol,...protocol}), 'x'.repeat(65537)])('200 sem protocolo válido não é sucesso (%#)', async body => {
    const {request,call}=transport(200,body)
    expect(await solicitarRelatorioVortxHttp(input,request)).toEqual({estado:'indeterminada',protocolo:null,http:200});expect(call).toHaveBeenCalledTimes(1)
  })
  it('timeout e erro de rede não autorizam repetição', async () => {
    const {request,call}=transport(0,'',Object.assign(new Error('timeout com token privado'),{code:'ECONNRESET'}))
    expect(await solicitarRelatorioVortxHttp(input,request)).toEqual({estado:'indeterminada',protocolo:null,http:null});expect(call).toHaveBeenCalledTimes(1)
    expect(console.info).toHaveBeenCalledWith('vortx_report_transport',expect.objectContaining({http:null,codigo:'ECONNRESET',categoria:'conexao'}))
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/token privado|opaque-qa-token|synthetic-private-key|synthetic-cert/)
  })
  it('token ausente não faz HTTP', async () => {
    const {request,call}=transport(200,'{}');await expect(solicitarRelatorioVortxHttp({...input,token:''},request)).rejects.toThrow('INVALID_VORTX_REPORT_CONTEXT');expect(call).not.toHaveBeenCalled()
  })
  it('certificado ausente bloqueia o POST, sem fallback para fetch', async () => {
    const {request,call}=transport(200,'{}')
    await expect(solicitarRelatorioVortxHttp({...input,credential:{certificadoPem:'',chavePrivadaPem:''}},request)).rejects.toThrow('INVALID_VORTX_REPORT_CONTEXT')
    expect(call).not.toHaveBeenCalled()
  })
})
