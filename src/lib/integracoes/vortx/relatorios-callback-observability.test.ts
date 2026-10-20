import { describe, expect, it, vi } from 'vitest'
import { receberCallbackRelatorio, type CallbackRepository } from './relatorios-callback-handler.server'
import { hashSegredoCallback } from './relatorios-callback'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const token = 'a'.repeat(64), signedUrl = 'https://example.invalid/report?signature=synthetic-private'
const binding = { endpointId: id, fundoId: id, ambiente: 'producao' as const, codigoCarteira: 'qa-wallet', revisao: 1 }
const event = { idRelatorio: other, idCarteira: 'qa-wallet', tipoRelatorio: 'PosicaoParcela',
  dataInicio: '2026-10-16', dataFim: '2026-10-19', dataReferencia: '2026-10-19',
  statusRelatorio: 'Disponível', urlRelatorio: signedUrl, dataExpiracao: '2026-10-21T12:00:00Z' }
const request = (query = `endpoint=${id}&token=${token}`, body = JSON.stringify(event), headers = {}) =>
  new Request(`https://example.invalid/callback?${query}`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } })
const repository = (): CallbackRepository => ({ autorizar: vi.fn().mockResolvedValue({ status: 'AUTHORIZED', ...binding }),
  persistir: vi.fn().mockResolvedValue(undefined), diagnosticarRejeicao: vi.fn().mockResolvedValue(undefined) })
const allowedKeys = ['autorizacao', 'endpointFormatoValido', 'endpointQuantidade', 'etapa', 'metodo', 'motivo', 'tipoConteudo', 'tokenFormatoValido', 'tokenQuantidade'].sort()

describe('sanitized callback observability does not authorize or consume bodies', () => {
  it.each([
    ['', 'ENDPOINT_AUSENTE', 0, 0],
    [`token=${token}`, 'ENDPOINT_AUSENTE', 0, 1],
    [`endpoint=${id}&endpoint=${id}&endpoint=${id}&token=${token}`, 'ENDPOINT_DUPLICADO', 2, 1],
    [`endpoint=synthetic-invalid&token=${token}`, 'ENDPOINT_FORMATO_INVALIDO', 1, 1],
    [`endpoint=${id}`, 'TOKEN_AUSENTE', 1, 0],
    [`endpoint=${id}&token=${token}&token=${token}`, 'TOKEN_DUPLICADO', 1, 2],
    [`endpoint=${id}&token=short`, 'TOKEN_FORMATO_INVALIDO', 1, 1],
    [`endpoint=${id}&token=${'A'.repeat(64)}`, 'TOKEN_FORMATO_INVALIDO', 1, 1],
    [`endpoint=${id}&token=${token}%0A`, 'TOKEN_FORMATO_INVALIDO', 1, 1],
    [`endpoint=${id}&access_token=${token}`, 'TOKEN_AUSENTE', 1, 0],
  ] as const)('explains parameter rejection %# without DB or body capture', async (query, motivo, endpointQuantidade, tokenQuantidade) => {
    const repo = repository(), observe = vi.fn(), req = request(query)
    const response = await receberCallbackRelatorio(req, repo, id, observe)
    expect(response.status).toBe(401); expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(observe).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ etapa: 'PARAMETROS', motivo,
      endpointQuantidade, tokenQuantidade, autorizacao: 'NAO_EXECUTADA', metodo: 'POST', tipoConteudo: 'JSON' }))
    expect(Object.keys(observe.mock.calls[0][0]).sort()).toEqual(allowedKeys)
    expect(JSON.stringify(observe.mock.calls)).not.toContain(token)
    expect(JSON.stringify(observe.mock.calls)).not.toContain(id)
    expect(JSON.stringify(observe.mock.calls)).not.toContain(signedUrl)
    expect(req.bodyUsed).toBe(false)
    expect(repo.autorizar).not.toHaveBeenCalled(); expect(repo.persistir).not.toHaveBeenCalled()
    expect(repo.diagnosticarRejeicao).not.toHaveBeenCalled()
  })

  it.each([
    ['UNAUTHORIZED', 401, 'NEGADA', 'AUTORIZACAO_NEGADA'],
    ['RATE_LIMITED', 429, 'LIMITE', 'LIMITE_ATINGIDO'],
  ] as const)('distinguishes %s without weakening the existing status', async (status, http, autorizacao, motivo) => {
    const repo = repository(), observe = vi.fn(), req = request()
    vi.mocked(repo.autorizar).mockResolvedValue({ status })
    const response = await receberCallbackRelatorio(req, repo, id, observe)
    expect(response.status).toBe(http)
    if (http === 429) expect(response.headers.get('retry-after')).toBe('60')
    expect(observe).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ etapa: 'AUTORIZACAO', autorizacao, motivo,
      endpointFormatoValido: true, tokenFormatoValido: true }))
    expect(repo.autorizar).toHaveBeenCalledExactlyOnceWith(id, hashSegredoCallback(token))
    expect(req.bodyUsed).toBe(false); expect(repo.diagnosticarRejeicao).not.toHaveBeenCalled()
    expect(repo.persistir).not.toHaveBeenCalled()
    expect(JSON.stringify(observe.mock.calls)).not.toContain(hashSegredoCallback(token))
  })

  it('keeps cross-fund rejection before body read and capture', async () => {
    const repo = repository(), observe = vi.fn(), req = request()
    expect((await receberCallbackRelatorio(req, repo, other, observe)).status).toBe(401)
    expect(observe).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ etapa: 'AUTORIZACAO', motivo: 'FUNDO_DIVERGENTE', autorizacao: 'FUNDO_DIVERGENTE' }))
    expect(req.bodyUsed).toBe(false); expect(repo.diagnosticarRejeicao).not.toHaveBeenCalled(); expect(repo.persistir).not.toHaveBeenCalled()
  })

  it('does not expose arbitrary method, content type, query names, headers, body, tokens, IDs or error messages', async () => {
    const repo = repository(), observe = vi.fn()
    const req = request(`endpoint=${id}&token=${token}&synthetic-secret-name=synthetic-secret-value`, 'synthetic-secret-body',
      { 'content-type': 'application/synthetic-secret-type', authorization: 'Bearer synthetic-secret-header' })
    expect((await receberCallbackRelatorio(req, repo, id, observe)).status).toBe(415)
    expect(observe).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tipoConteudo: 'OUTRO', motivo: 'TIPO_CONTEUDO_INVALIDO', autorizacao: 'AUTORIZADA' }))
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(/synthetic-secret|Bearer|signature|https:|aaaaaaaa|bbbbbbbb/)
    expect(req.bodyUsed).toBe(false)
    vi.mocked(repo.autorizar).mockRejectedValue(new Error(`synthetic-secret-error ${token} ${signedUrl}`))
    expect((await receberCallbackRelatorio(request(), repo, id, observe)).status).toBe(503)
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ motivo: 'AUTORIZACAO_INDISPONIVEL', autorizacao: 'FALHA' }))
    expect(JSON.stringify(observe.mock.calls)).not.toContain('synthetic-secret-error')
  })

  it('reports no-body GET as 405 without authorizing or echoing its query', async () => {
    const repo = repository(), observe = vi.fn()
    const res = await receberCallbackRelatorio(new Request(`https://example.invalid/?token=${token}`), repo, id, observe)
    expect(res.status).toBe(405); expect(res.headers.get('allow')).toBe('POST')
    expect(observe).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ metodo: 'OUTRO', tipoConteudo: 'AUSENTE', motivo: 'METODO_NAO_SUPORTADO', tokenFormatoValido: null }))
    expect(repo.autorizar).not.toHaveBeenCalled()
  })

  it('does not turn an authenticated invalid JSON into success or log its body', async () => {
    const repo = repository(), observe = vi.fn(), req = request(undefined, '{synthetic-secret-body')
    expect((await receberCallbackRelatorio(req, repo, id, observe)).status).toBe(400)
    expect(observe).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ motivo: 'JSON_INVALIDO', etapa: 'CONTRATO', autorizacao: 'AUTORIZADA' }))
    expect(repo.diagnosticarRejeicao).toHaveBeenCalledOnce(); expect(repo.persistir).not.toHaveBeenCalled()
    expect(JSON.stringify(observe.mock.calls)).not.toContain('synthetic-secret-body')
  })

  it.each([200, 401, 503])('observer failure cannot change the HTTP %s contract', async http => {
    const repo = repository()
    if (http === 401) vi.mocked(repo.autorizar).mockResolvedValue({ status: 'UNAUTHORIZED' })
    if (http === 503) vi.mocked(repo.persistir).mockRejectedValue(new Error('synthetic-secret-error'))
    const observe = vi.fn(() => { throw new Error('synthetic-secret-observer') })
    expect((await receberCallbackRelatorio(request(), repo, id, observe)).status).toBe(http)
    expect(observe).toHaveBeenCalledOnce()
  })

  it('reports success only after durable commit, without retaining signed links in metadata', async () => {
    const repo = repository(), observe = vi.fn()
    let commit!: () => void
    vi.mocked(repo.persistir).mockImplementation(() => new Promise<void>(resolve => { commit = resolve }))
    const pending = receberCallbackRelatorio(request(), repo, id, observe)
    await vi.waitFor(() => expect(repo.persistir).toHaveBeenCalledOnce())
    expect(observe).not.toHaveBeenCalled(); commit()
    expect((await pending).status).toBe(200)
    expect(observe).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ etapa: 'PERSISTENCIA', motivo: 'RECEBIDO', autorizacao: 'AUTORIZADA' }))
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(/signature|https:|qa-wallet|aaaaaaaa|bbbbbbbb/)
  })
})
