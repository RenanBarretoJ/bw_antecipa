import { afterEach, describe, expect, it, vi } from 'vitest'
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from 'node:crypto'
import { CALLBACK_PATH } from './relatorios-callback'
import { configurarCapturaCallback, iniciarCapturaCallback, type CaptureEnvelope } from './relatorios-callback-capture.server'
import { receberCallbackRelatorio } from './relatorios-callback-handler.server'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const now = Date.parse('2026-10-20T17:00:00Z')
const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
function decrypt(value: string, captureId = id) {
  const [format, wrapped, iv, tag, encrypted] = value.split(':')
  expect(format).toBe('rsa1')
  const secret = privateDecrypt({ key: keys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(wrapped, 'base64url'))
  const cipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(iv, 'base64url'))
  cipher.setAAD(Buffer.from(`VORTX_CALLBACK_APPLICATION_REQUEST_V1:${captureId}`))
  cipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64url')), cipher.final()]).toString('utf8')
}
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/vortx-real-data-preview',
  NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co', VORTX_REPORTS_PREVIEW_ENABLED: 'true',
  VORTX_REPORTS_PREVIEW_FUNDO_ID: id, VORTX_REPORT_CALLBACK_PREVIEW_ENABLED: 'true',
  VORTX_REPORT_CALLBACK_URL_RISK_ACCEPTED: 'true', VORTX_REPORT_CALLBACK_RAW_CAPTURE_ID: id,
  VORTX_REPORT_CALLBACK_RAW_ENDPOINT_ID: id, VORTX_REPORT_CALLBACK_RAW_CAPTURE_UNTIL: '2026-10-20T18:00:00Z' }
const url = `https://example.invalid${CALLBACK_PATH}?endpoint=${id}&other=a%2Bb&other=%20`
const body = '{ "idRelatorio": "synthetic", "message": "ação" }\r\n'
const request = (value: BodyInit = body, target = url) => new Request(target, { method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8', 'x-api-key': 'SYNTHETIC-API-KEY' }, body: value })
function repository() {
  return { reservar: vi.fn().mockResolvedValue(true), salvar: vi.fn().mockResolvedValue(true) }
}
function enable() { vi.spyOn(Date, 'now').mockReturnValue(now) }
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); mocks.rpc.mockReset() })

describe('one-shot encrypted application-level callback capture', () => {
  it('is opt-in, on the exact Preview, endpoint and callback path only', () => {
    expect(configurarCapturaCallback(request(), {}, now)).toBeNull()
    expect(configurarCapturaCallback(request(), env, now)).toMatchObject({ id, endpointId: id, fundoId: id })
    expect(configurarCapturaCallback(request(undefined, url.replace(id, other)), env, now)).toBeNull()
    expect(configurarCapturaCallback(request(undefined, url + `&endpoint=${id}`), env, now)).toBeNull()
    expect(configurarCapturaCallback(request(undefined, url.replace(CALLBACK_PATH, '/another')), env, now)).toBeNull()
    expect(configurarCapturaCallback(new Request(url), env, now)).toBeNull()
  })
  it.each(Object.keys(env))('fails closed for a changed/missing %s', key => {
    expect(configurarCapturaCallback(request(), { ...env, [key]: '' }, now)).toBeNull()
  })
  it.each(['invalid', '2026-10-20T16:59:00Z', '2026-10-20T19:00:01Z'])('rejects deadline %s', until => {
    expect(configurarCapturaCallback(request(), { ...env, VORTX_REPORT_CALLBACK_RAW_CAPTURE_UNTIL: until }, now)).toBeNull()
  })
  it('does not construct a repository or consume the body when disabled', () => {
    const factory = vi.fn(), req = request()
    expect(iniciarCapturaCallback(req, factory, {})).toBeNull()
    expect(req.bodyUsed).toBe(false); expect(factory).not.toHaveBeenCalled()
  })
  it('preserves delivered URL, duplicate query parameters, all delivered headers and exact body bytes; 401 remains 401', async () => {
    enable()
    const repo = repository(), req = request(), finish = iniciarCapturaCallback(req, () => repo, env)!
    const business = { autorizar: vi.fn(), persistir: vi.fn() }
    const response = await receberCallbackRelatorio(req, business, id)
    expect(response.status).toBe(401)
    expect(await finish(response.status)).toEqual({ estado: 'SALVA', completa: true })
    const saved: CaptureEnvelope = repo.salvar.mock.calls[0][1]
    expect(saved).toMatchObject({ url, metodo: 'POST', statusHttp: 401, origemNaoAutenticada: true,
      nivelCaptura: 'WEB_REQUEST_APOS_VERCEL_NAO_WIRE', corpoCompleto: true, motivoCorpo: 'EOF', bytesCorpo: Buffer.byteLength(body) })
    expect(saved.headers).toContainEqual(['x-api-key', 'SYNTHETIC-API-KEY'])
    expect(saved.headers).toContainEqual(['content-type', 'application/json; charset=utf-8'])
    expect(Buffer.from(saved.corpoBase64, 'base64').toString()).toBe(body)
    expect(business.autorizar).not.toHaveBeenCalled(); expect(business.persistir).not.toHaveBeenCalled()
    // Reading the diagnostic clone never consumes the original rejected request.
    expect(req.bodyUsed).toBe(false); expect(await req.text()).toBe(body)
  })
  it('does not capture after the database slot has been consumed', async () => {
    enable(); const repo = repository(); repo.reservar.mockResolvedValue(false)
    expect(await iniciarCapturaCallback(request(), () => repo, env)!(401)).toEqual({ estado: 'IGNORADA' })
    expect(repo.salvar).not.toHaveBeenCalled()
  })
  it.each(['reserve', 'save'])('never changes the canonical response or exposes a %s error', async stage => {
    enable(); const repo = repository(), req = request()
    const method = stage === 'reserve' ? repo.reservar : repo.salvar
    method.mockRejectedValue(new Error('SYNTHETIC-API-KEY private-body'))
    const finish = iniciarCapturaCallback(req, () => repo, env)!
    const response = await receberCallbackRelatorio(req, { autorizar: vi.fn(), persistir: vi.fn() }, id)
    expect(await finish(response.status)).toEqual({ estado: 'FALHA' }); expect(response.status).toBe(401)
  })
  it('marks a bounded prefix as incomplete, never as the complete request', async () => {
    enable(); const repo = repository()
    expect(await iniciarCapturaCallback(request('x'.repeat(20000)), () => repo, env)!(401)).toEqual({ estado: 'SALVA', completa: false })
    expect(repo.salvar.mock.calls[0][1]).toMatchObject({ bytesCorpo: 16384, corpoCompleto: false, motivoCorpo: 'LIMITE' })
  })
  it('keeps binary/non-UTF8 body bytes without reparsing or normalizing JSON', async () => {
    enable(); const repo = repository(), bytes = new Uint8Array([0, 255, 254, 13, 10])
    await iniciarCapturaCallback(request(bytes), () => repo, env)!(401)
    expect(Buffer.from(repo.salvar.mock.calls[0][1].corpoBase64, 'base64')).toEqual(Buffer.from(bytes))
  })
  it('records a read timeout as incomplete and leaves the response unchanged', async () => {
    enable(); vi.useFakeTimers()
    const repo = repository(), stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])) } })
    const req = new Request(url, { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    const finish = iniciarCapturaCallback(req, () => repo, env)!(401)
    await vi.advanceTimersByTimeAsync(1600)
    expect(await finish).toEqual({ estado: 'SALVA', completa: false })
    expect(repo.salvar.mock.calls[0][1]).toMatchObject({ motivoCorpo: 'TIMEOUT', corpoCompleto: false })
    void req.body?.cancel()
  })
  it('refuses oversized URL/header metadata without putting it in the database', async () => {
    enable(); const repo = repository(), req = request()
    req.headers.set('x-huge', 'x'.repeat(70000))
    expect(await iniciarCapturaCallback(req, () => repo, env)!(401)).toEqual({ estado: 'FALHA' })
    expect(repo.salvar).not.toHaveBeenCalled()
  })
  it('encrypts all sensitive values before RPC and authenticates ciphertext integrity', async () => {
    enable()
    vi.stubEnv('VORTX_REPORT_CALLBACK_RAW_PUBLIC_KEY_PEM', keys.publicKey)
    const abortSignal = vi.fn().mockResolvedValueOnce({ error: null, data: { estado: 'RESERVADA' } })
      .mockResolvedValueOnce({ error: null, data: { estado: 'SALVA' } })
    mocks.rpc.mockReturnValue({ abortSignal })
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(await iniciarCapturaCallback(request(), undefined, env)!(401)).toEqual({ estado: 'SALVA', completa: true })
    const [name, args] = mocks.rpc.mock.calls[1]
    expect(name).toBe('vortx_concluir_captura_callback')
    expect(JSON.stringify(args)).not.toContain('SYNTHETIC-API-KEY'); expect(JSON.stringify(args)).not.toContain(url)
    const envelope = JSON.parse(decrypt(args.p_ciphertext))
    expect(envelope.headers).toContainEqual(['x-api-key', 'SYNTHETIC-API-KEY'])
    expect(envelope.url).toBe(url)
    expect(() => decrypt(args.p_ciphertext.slice(0, -4) + 'xxxx')).toThrow()
    expect(() => decrypt(args.p_ciphertext, other)).toThrow()
    expect(args.p_chave_versao).toBe('capture-rsa-v1')
    expect(log).not.toHaveBeenCalled()
  })
  it('has no plaintext fallback when the keyring is unavailable', async () => {
    enable(); vi.stubEnv('VORTX_REPORT_CALLBACK_RAW_PUBLIC_KEY_PEM', '')
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ error: null, data: { estado: 'RESERVADA' } }) })
    expect(await iniciarCapturaCallback(request(), undefined, env)!(401)).toEqual({ estado: 'FALHA' })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})
