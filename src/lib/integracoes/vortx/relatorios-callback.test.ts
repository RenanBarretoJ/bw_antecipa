import { afterEach, describe, expect, it, vi } from 'vitest'
import { callbackPreviewPermitido, gerarSegredoCallback, hashSegredoCallback, interpretarCallbackRelatorio, prepararEventoCallback, type CallbackBinding } from './relatorios-callback'
import { receberCallbackRelatorio, type CallbackRepository } from './relatorios-callback-handler.server'
import { criarRepositorioCallbackRelatorio } from './relatorios-callback-repository.server'
import { descriptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const token = 'a'.repeat(64) // Synthetic, never a provider credential.
const binding: CallbackBinding = { endpointId: id, fundoId: id, ambiente: 'producao', codigoCarteira: 'qa-carteira', revisao: 1 }
const raw = { idRelatorio: id, idCarteira: binding.codigoCarteira, tipoRelatorio: 'PosicaoNivelParcela',
  dataReferencia: '2026-10-16', dataInicio: '2026-10-01', dataFim: '2026-10-16', statusRelatorio: 'Disponível',
  urlRelatorio: 'https://example.invalid/report?synthetic=private', dataExpiracao: '2026-10-20T01:00:00-03:00' }
const event = () => interpretarCallbackRelatorio(raw)
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/vortx-real-data-preview', NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co',
  VORTX_REPORTS_PREVIEW_ENABLED: 'true', VORTX_REPORTS_PREVIEW_FUNDO_ID: id, VORTX_REPORT_CALLBACK_PREVIEW_ENABLED: 'true', VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED: 'true' }
const request = (body: string | Uint8Array = JSON.stringify(raw), query = `endpoint=${id}&token=${token}`, headers: Record<string, string> = {}) =>
  new Request(`https://example.invalid/callback?${query}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body as BodyInit })
const repository = (): CallbackRepository => ({ autorizar: vi.fn().mockResolvedValue({ status: 'AUTHORIZED', ...binding }), persistir: vi.fn().mockResolvedValue(undefined) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Vortx callback contract', () => {
  it.each([['PosicaoNivelParcela', 'PosicaoParcela'], ['PosicaoNivelAtivo', 'PosicaoAtivo'], ['Inclusao', 'Inclusao'], ['Exclusao', 'Exclusao']])('normalizes documented %s', (input, output) => {
    expect(interpretarCallbackRelatorio({ ...raw, tipoRelatorio: input }).tipoRelatorio).toBe(output)
  })
  it.each([
    { tipoRelatorio: 'Consolidado' }, { statusRelatorio: 'pronto' }, { idRelatorio: 'invalid' }, { idCarteira: 'invalid|wallet' },
    { tipoRelatorio: 'Inclusao', dataInicio: '2026-10-17' }, { dataFim: '2026-02-31' }, { urlRelatorio: null }, { dataExpiracao: null },
    { urlRelatorio: 'http://example.invalid/' }, { urlRelatorio: 'https://user:pass@example.invalid/' },
    { urlRelatorio: 'https://example.invalid/#secret' }, { extra: 'unexpected' },
  ])('rejects invalid or unsupported event %# without echoing input', change => {
    expect(() => interpretarCallbackRelatorio({ ...raw, ...change })).toThrow('Callback de relatorio invalido.')
  })
  it('accepts generation without URL; normalizes timestamp and deduplicates equivalent metadata', () => {
    expect(interpretarCallbackRelatorio({ ...raw, statusRelatorio: 'Em geração', urlRelatorio: null, dataExpiracao: null }).urlRelatorio).toBeNull()
    expect(event().dataExpiracao).toBe('2026-10-20T04:00:00.000Z')
    const first = prepararEventoCallback(id, event())
    expect(JSON.stringify(first.metadados)).not.toContain(raw.urlRelatorio)
    expect(first).toEqual(prepararEventoCallback(id, interpretarCallbackRelatorio({ ...raw, dataExpiracao: '2026-10-20T04:00:00Z' })))
    expect(first.hash).not.toBe(prepararEventoCallback(other, event()).hash)
    expect(first.hash).not.toBe(prepararEventoCallback(id, interpretarCallbackRelatorio({ ...raw, urlRelatorio: 'https://example.invalid/renewed' })).hash)
    expect(first.hash).not.toBe(prepararEventoCallback(id, interpretarCallbackRelatorio({ ...raw, statusRelatorio: 'Expirado' })).hash)
  })
  it('generates independent 256-bit URL secrets and stores only their hash', () => {
    const first = gerarSegredoCallback(), second = gerarSegredoCallback()
    expect(first.segredo).toMatch(/^[0-9a-f]{64}$/); expect(first.hash).toBe(hashSegredoCallback(first.segredo))
    expect(first.hash).not.toBe(first.segredo); expect(first.segredo).not.toBe(second.segredo)
  })
  it('is disabled by default', () => expect(callbackPreviewPermitido({})).toBe(false))
  it('allows only the explicitly authorized Preview', () => expect(callbackPreviewPermitido(env)).toBe(true))
  it.each(Object.keys(env))('fails closed if %s changes', key => expect(callbackPreviewPermitido({ ...env, [key]: 'other' })).toBe(false))
  const exception = { ...env, VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED: 'false', VORTX_REPORT_CALLBACK_URL_RISK_ACCEPTED: 'true' }
  it('accepts the explicit Preview risk exception without claiming redaction', () => {
    expect(callbackPreviewPermitido(exception)).toBe(true)
    expect(exception.VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED).toBe('false')
  })
  it.each(['false', '', 'TRUE', undefined])('does not infer risk acceptance from %s', value => {
    expect(callbackPreviewPermitido({ ...exception, VORTX_REPORT_CALLBACK_URL_RISK_ACCEPTED: value })).toBe(false)
  })
  it.each([
    ['VERCEL_ENV', 'production'], ['VERCEL_ENV', 'development'],
    ['VERCEL_GIT_COMMIT_REF', 'homolog'], ['VERCEL_GIT_COMMIT_REF', 'main'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://wwsndnuvnjuabpbjwlck.supabase.co'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://fhgkmggthxikfpogrvaa.supabase.co'],
    ['VORTX_REPORTS_PREVIEW_FUNDO_ID', 'invalid'], ['VORTX_REPORTS_PREVIEW_ENABLED', 'false'],
    ['VORTX_REPORT_CALLBACK_PREVIEW_ENABLED', 'false'],
  ])('risk acceptance never overrides %s=%s', (key, value) => {
    expect(callbackPreviewPermitido({ ...exception, [key]: value })).toBe(false)
  })
})

describe('bounded durable receipt without downloads', () => {
  it.each(['', `endpoint=${id}`, `endpoint=${id}&token=bad`, `endpoint=${id}&token=${token}&token=${token}`, `endpoint=${id}&endpoint=${id}&token=${token}`])('rejects malformed authorization %# before DB', async query => {
    const repo = repository(); expect((await receberCallbackRelatorio(request(undefined, query), repo, id)).status).toBe(401)
    expect(repo.autorizar).not.toHaveBeenCalled(); expect(repo.persistir).not.toHaveBeenCalled()
  })
  it.each([['UNAUTHORIZED', 401], ['RATE_LIMITED', 429]] as const)('maps %s safely', async (status, expected) => {
    const repo = repository(); vi.mocked(repo.autorizar).mockResolvedValue({ status })
    const response = await receberCallbackRelatorio(request(), repo, id)
    expect(response.status).toBe(expected); expect(await response.text()).toBe(''); expect(repo.persistir).not.toHaveBeenCalled()
    if (expected === 429) expect(response.headers.get('retry-after')).toBe('60')
  })
  it('rejects another Fund and wallet', async () => {
    const repo = repository()
    expect((await receberCallbackRelatorio(request(), repo, other)).status).toBe(401)
    expect((await receberCallbackRelatorio(request(JSON.stringify({ ...raw, idCarteira: 'other' })), repo, id)).status).toBe(403)
    expect(repo.persistir).not.toHaveBeenCalled()
  })
  it.each([
    ['{', {}, 400], [JSON.stringify({ ...raw, rawSecret: token }), {}, 400], ['x'.repeat(17000), {}, 413],
    ['', { 'content-length': '17000' }, 413], [JSON.stringify(raw), { 'content-type': 'text/plain' }, 415],
    [JSON.stringify(raw), { 'content-encoding': 'gzip' }, 415],
  ] as [string, Record<string, string>, number][])('rejects invalid or oversized input %#', async (body, headers, status) => {
    const repo = repository(); const response = await receberCallbackRelatorio(request(body, undefined, headers), repo, id)
    expect(response.status).toBe(status); expect(await response.text()).toBe(''); expect(repo.persistir).not.toHaveBeenCalled()
  })
  it('rejects invalid UTF8 and non-POST', async () => {
    expect((await receberCallbackRelatorio(request(new Uint8Array([0xff])), repository(), id)).status).toBe(400)
    expect((await receberCallbackRelatorio(new Request('https://example.invalid'), repository(), id)).status).toBe(405)
  })
  it('does not acknowledge before commit and never downloads', async () => {
    const repo = repository(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    let commit!: () => void
    vi.mocked(repo.persistir).mockImplementation(() => new Promise<void>(resolve => { commit = resolve }))
    let acknowledged = false
    const receipt = receberCallbackRelatorio(request(), repo, id).then(response => { acknowledged = true; return response })
    await vi.waitFor(() => expect(repo.persistir).toHaveBeenCalledOnce())
    expect(acknowledged).toBe(false); commit()
    const response = await receipt
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(fetch).not.toHaveBeenCalled()
    expect(repo.autorizar).toHaveBeenCalledWith(id, hashSegredoCallback(token))
  })
  it.each(['autorizar', 'persistir'] as const)('returns retryable 503 without leaking %s error', async method => {
    const repo = repository(); vi.mocked(repo[method]).mockRejectedValue(new Error(`${token} ${raw.urlRelatorio}`))
    const response = await receberCallbackRelatorio(request(), repo, id)
    expect(response.status).toBe(503); expect(await response.text()).toBe('')
  })
})

describe('encrypted inbox adapter', () => {
  it('sends URL only inside authenticated ciphertext, bound to scope and event identity', async () => {
    vi.stubEnv('PORTAL_FIDC_CREDENTIAL_KEYS_JSON', JSON.stringify({ qa: 'b'.repeat(64) })); vi.stubEnv('PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION', 'qa')
    const rpc = vi.fn().mockResolvedValue({ data: { recebido: true, duplicado: false }, error: null })
    const repo = criarRepositorioCallbackRelatorio({ rpc } as unknown as Parameters<typeof criarRepositorioCallbackRelatorio>[0])
    await repo.persistir(binding, hashSegredoCallback(token), event())
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('vortx_receber_callback'); expect(JSON.stringify(args)).not.toContain(raw.urlRelatorio)
    expect(JSON.stringify(args)).not.toContain(token); expect(args.p_ciphertext).toMatch(/^v1:/)
    expect(JSON.parse(descriptografarPortalFidcValor(args.p_ciphertext, args.p_chave_versao))).toMatchObject({
      purpose: 'VORTX_CALLBACK_RELATORIO_V1', endpointId: id, fundoId: id, ambiente: binding.ambiente, codigoCarteira: binding.codigoCarteira,
      hash: args.p_hash_evento, evento: event(),
    })
    expect(() => descriptografarPortalFidcValor(args.p_ciphertext.slice(0, -4) + 'xxxx', 'qa')).toThrow()
  })
  it('cannot persist without an encryption key', async () => {
    vi.stubEnv('PORTAL_FIDC_CREDENTIAL_KEYS_JSON', '{}'); vi.stubEnv('PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION', 'missing')
    const rpc = vi.fn(); const repo = criarRepositorioCallbackRelatorio({ rpc } as unknown as Parameters<typeof criarRepositorioCallbackRelatorio>[0])
    await expect(repo.persistir(binding, hashSegredoCallback(token), event())).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([null, { recebido: false }, { recebido: true }])('rejects missing durable commit evidence %#', async data => {
    vi.stubEnv('PORTAL_FIDC_CREDENTIAL_KEYS_JSON', JSON.stringify({ qa: 'b'.repeat(64) })); vi.stubEnv('PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION', 'qa')
    const rpc = vi.fn().mockResolvedValue({ data, error: null })
    const repo = criarRepositorioCallbackRelatorio({ rpc } as unknown as Parameters<typeof criarRepositorioCallbackRelatorio>[0])
    await expect(repo.persistir(binding, hashSegredoCallback(token), event())).rejects.toThrow('recebimento duravel')
  })
})
