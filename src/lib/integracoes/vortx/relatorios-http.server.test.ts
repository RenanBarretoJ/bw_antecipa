import { describe, expect, it, vi } from 'vitest'
import { solicitarRelatorioVortxHttp } from './relatorios-http.server'
const pedido = { codigoCarteira: 'qa-carteira', tipoRelatorio: 'PosicaoParcela' as const, dataInicio:'2020-01-01', dataFim:'2020-01-31', dataReferencia:'2020-01-31', extensaoArquivo:2 as const }
const input = { ambiente:'producao' as const, token:'opaque-qa-token', pedido }
const protocol = { id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status:0, dataSolicitacao:'2026-10-19T17:00:00Z' }
describe('solicitação Vórtx: transporte de protocolo', () => {
  it.each(['producao','homologacao'] as const)('POST único no host fixo %s', async ambiente => {
    const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({data:protocol})))
    expect(await solicitarRelatorioVortxHttp({...input,ambiente},request)).toEqual({estado:'aceita',protocolo:protocol.id,http:200})
    expect(request).toHaveBeenCalledTimes(1)
    const [url,init]=request.mock.calls[0]
    expect(String(url)).toBe(`${ambiente==='producao'?'https://api.vortx.com.br':'https://api-stg.vortx.com.br'}/v1/vrs/externo/solicitar`)
    expect(init).toMatchObject({method:'POST',redirect:'manual',credentials:'omit',cache:'no-store',headers:{Authorization:'Bearer opaque-qa-token'},body:JSON.stringify(pedido)})
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
  it.each([400,401,403,404,405,415,422,429])('HTTP %s é recusa, sem expor corpo ou repetir', async http => {
    const request=vi.fn<typeof fetch>().mockResolvedValue(new Response('Bearer segredo-real',{status:http}))
    const result=await solicitarRelatorioVortxHttp(input,request)
    expect(result).toEqual({estado:'recusada',protocolo:null,http});expect(JSON.stringify(result)).not.toContain('segredo-real');expect(request).toHaveBeenCalledTimes(1)
  })
  it.each([301,302,307,500,502,503])('HTTP %s é inconclusivo, sem redirect/retry', async http => {
    const request=vi.fn<typeof fetch>().mockResolvedValue(new Response('privado',{status:http,headers:{Location:'https://outro.test'}}))
    expect(await solicitarRelatorioVortxHttp(input,request)).toEqual({estado:'indeterminada',protocolo:null,http});expect(request).toHaveBeenCalledTimes(1)
  })
  it.each(['', '[]', '{}', '<html>segredo</html>', JSON.stringify({...protocol,status:1}), JSON.stringify({data:protocol,...protocol}), 'x'.repeat(65537)])('200 sem protocolo válido não é sucesso (%#)', async body => {
    const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
    expect(await solicitarRelatorioVortxHttp(input,request)).toEqual({estado:'indeterminada',protocolo:null,http:200});expect(request).toHaveBeenCalledTimes(1)
  })
  it('timeout e erro de rede não autorizam repetição', async () => {
    const request=vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout com token privado'))
    expect(await solicitarRelatorioVortxHttp(input,request)).toEqual({estado:'indeterminada',protocolo:null,http:null});expect(request).toHaveBeenCalledTimes(1)
  })
  it('token ausente não faz HTTP', async () => {
    const request=vi.fn<typeof fetch>();await expect(solicitarRelatorioVortxHttp({...input,token:''},request)).rejects.toThrow('INVALID_VORTX_REPORT_CONTEXT');expect(request).not.toHaveBeenCalled()
  })
})
