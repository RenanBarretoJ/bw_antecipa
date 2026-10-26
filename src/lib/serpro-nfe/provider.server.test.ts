import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { querySerproNfe, readSerproNfeRuntimeConfig } from './provider.server'

const officialContract = JSON.parse(readFileSync(
  new URL('./__fixtures__/consulta-nfe-df.openapi.contract.json', import.meta.url),
  'utf8',
)) as {
  tokenUrl: string
  queryBaseUrl: string
  trialQueryBaseUrl: string
  sourceSha256: string
}

// Chave sintética modelo 55 com DV previamente calculado; nenhuma consulta real é feita.
const key = '35261014224864000100550020000021901123456788'
const config = {
  ready: true,
  workerEnabled: true,
  contractVerified: true,
  queryEnabled: true,
  consumerKey: 'qa-key',
  consumerSecret: 'qa-secret',
  tokenUrl: officialContract.tokenUrl,
  queryBaseUrl: officialContract.queryBaseUrl,
  timeoutMs: 30_000,
}

afterEach(() => vi.unstubAllEnvs())

describe('adapter SERPRO isolado', () => {
  it('permanece desabilitado sem três gates e credenciais', () => {
    expect(readSerproNfeRuntimeConfig({})).toMatchObject({ ready: false, workerEnabled: false, contractVerified: false, queryEnabled: false })
  })

  it('usa o endpoint de produção provado por fixture independente do Swagger', () => {
    expect(officialContract.sourceSha256).toBe('d607f4cb841e49b819f63587742a0bf902146ffb5981ed9b496cb0fdbf3f21fa')
    expect(readSerproNfeRuntimeConfig({})).toMatchObject({
      tokenUrl: officialContract.tokenUrl,
      queryBaseUrl: officialContract.queryBaseUrl,
    })
    expect(officialContract.queryBaseUrl).toContain('/consulta-nfe-df/api/v1/nfe/')
    expect(officialContract.queryBaseUrl).not.toContain('-trial/')
  })

  it.each([
    'https://gateway.apiserpro.serpro.gov.br/nfe/1/',
    officialContract.trialQueryBaseUrl,
  ])('recusa endpoint incompatível ou TRIAL mesmo com os demais gates ativos: %s', queryBaseUrl => {
    expect(readSerproNfeRuntimeConfig({
      SERPRO_NFE_WORKER_ENABLED: 'true',
      SERPRO_NFE_CONTRACT_VERIFIED: 'true',
      SERPRO_NFE_QUERY_ENABLED: 'true',
      SERPRO_NFE_CONSUMER_KEY: 'qa-key',
      SERPRO_NFE_CONSUMER_SECRET: 'qa-secret',
      SERPRO_NFE_BASE_URL: queryBaseUrl,
    })).toMatchObject({ ready: false, queryBaseUrl })
  })

  it('usa OAuth client_credentials e uma única consulta sem vazar segredo na URL', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'qa-token' }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ nfeProc: {} }), { status: 200 }))
    await expect(querySerproNfe(key, config, fetcher)).resolves.toMatchObject({ httpStatus: 200, payload: { nfeProc: {} } })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: 'grant_type=client_credentials', cache: 'no-store', redirect: 'error' })
    expect(String(fetcher.mock.calls[1][0])).toBe(`${config.queryBaseUrl}${key}`)
    expect(String(fetcher.mock.calls[1][0])).not.toContain(config.consumerSecret)
  })

  it.each([401, 403, 404, 408, 429, 500, 504])('classifica HTTP %s sem retentativa interna', async status => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'qa-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ erro: 'sanitized' }), { status }))
    await expect(querySerproNfe(key, config, fetcher)).rejects.toMatchObject({ code: `QUERY_HTTP_${status}`, httpStatus: status })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('timeout não vira sucesso nem resposta vazia', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('timeout', 'TimeoutError'))
    await expect(querySerproNfe(key, config, fetcher)).rejects.toMatchObject({ code: 'TOKEN_TIMEOUT' })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('recusa chave inválida antes de autenticar ou consultar', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(querySerproNfe('2190', config, fetcher)).rejects.toMatchObject({ code: 'INVALID_NFE_KEY' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['', '[]', '<html>erro</html>'])('recusa corpo ambíguo %j', async body => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'qa-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
    await expect(querySerproNfe(key, config, fetcher)).rejects.toMatchObject({ code: 'INVALID_JSON_RESPONSE' })
  })
})
