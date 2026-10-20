import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { criptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import { interpretarCallbackRelatorio, prepararEventoCallback } from './relatorios-callback'
import { inspecionarHostsPreservados } from './relatorios-host-inspection.server'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const token = 'a'.repeat(64), now = Date.parse('2026-10-20T22:00:00Z')
const config = { segredoHash: createHash('sha256').update(token).digest('hex'),
  inicio: '2026-10-20T21:59:00Z', fim: '2026-10-20T22:30:00Z', eventos: [id] }
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/vortx-real-data-preview',
  NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co', VORTX_REPORTS_PREVIEW_ENABLED: 'true',
  VORTX_REPORTS_PREVIEW_FUNDO_ID: id, VORTX_REPORT_HOST_INSPECTION_JSON: JSON.stringify(config) }
const url = 'https://example.invalid/inspect'
function request(change: RequestInit = {}, query = '') {
  return new Request(url + query, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, ...change })
}
function row(changes: Record<string, unknown> = {}) {
  const evento = interpretarCallbackRelatorio({ idRelatorio: id, idCarteira: 'qa-wallet', tipoRelatorio: 'PosicaoParcela',
    dataReferencia: '2026-10-19', statusRelatorio: 'Disponível',
    urlRelatorio: 'https://reports.example.invalid/private.csv?signature=synthetic-private-secret',
    dataExpiracao: '2026-10-22T12:00:00Z' })
  const { hash } = prepararEventoCallback(id, evento)
  const sealed = criptografarPortalFidcValor(JSON.stringify({ purpose: 'VORTX_CALLBACK_RELATORIO_V1',
    endpointId: id, fundoId: id, ambiente: 'producao', codigoCarteira: 'qa-wallet', hash, evento,
    corpoOriginal: 'historical-source-json-never-exported', ...changes }))
  return { id, endpoint_id: id, fundo_id: id, ambiente: 'producao', hash_evento: hash,
    payload_criptografado: sealed.ciphertext, chave_versao: sealed.chaveVersao, correlacao: 'PENDENTE' }
}
beforeEach(() => {
  vi.stubEnv('PORTAL_FIDC_CREDENTIAL_KEYS_JSON', JSON.stringify({ qa: Buffer.alloc(32, 7).toString('base64') }))
  vi.stubEnv('PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION', 'qa')
})
afterEach(() => vi.unstubAllEnvs())

describe('expiring Preview-only preserved host inspection', () => {
  it.each([
    { VERCEL_ENV: 'production' }, { VERCEL_GIT_COMMIT_REF: 'homolog' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://wwsndnuvnjuabpbjwlck.supabase.co' },
    { VORTX_REPORTS_PREVIEW_ENABLED: 'false' }, { VORTX_REPORT_HOST_INSPECTION_JSON: '' },
    { VORTX_REPORT_HOST_INSPECTION_JSON: '{' },
    { VORTX_REPORT_HOST_INSPECTION_JSON: JSON.stringify({ ...config, fim: '2026-10-20T23:00:01Z' }) },
  ])('does not touch database outside exact scope/window: %j', async changes => {
    const ler = vi.fn()
    expect((await inspecionarHostsPreservados(request(), { env: { ...env, ...changes }, now, ler })).status).toBe(404)
    expect(ler).not.toHaveBeenCalled()
  })
  it.each([now - 120000, Date.parse(config.fim), Date.parse(config.fim) + 1])('rejects inactive window %i', async time => {
    const ler = vi.fn()
    expect((await inspecionarHostsPreservados(request(), { env, now: time, ler })).status).toBe(404)
    expect(ler).not.toHaveBeenCalled()
  })
  it.each(['', 'Bearer wrong', `Bearer ${'b'.repeat(64)}`, `Bearer ${token}, Bearer ${token}`])('rejects invalid credential before DB', async authorization => {
    const ler = vi.fn()
    const response = await inspecionarHostsPreservados(request({ headers: { authorization } }), { env, now, ler })
    expect(response.status).toBe(401); expect(await response.text()).toBe(''); expect(ler).not.toHaveBeenCalled()
  })
  it.each([request({ body: '{}' }), request({}, '?event=' + other), request({ method: 'GET' })])('does not accept caller-supplied scope/payload', async req => {
    const ler = vi.fn()
    expect([400, 405]).toContain((await inspecionarHostsPreservados(req, { env, now, ler })).status)
    expect(ler).not.toHaveBeenCalled()
  })
  it('returns only derived metadata; PENDENTE never becomes an import/download approval', async () => {
    const ler = vi.fn().mockResolvedValue([row()])
    const response = await inspecionarHostsPreservados(request(), { env, now, ler })
    expect(response.status).toBe(200); expect(ler).toHaveBeenCalledWith(id, [id])
    expect(await response.json()).toEqual({ somenteLeitura: true, downloadAutorizado: false, hosts: [{
      tipo: 'PosicaoParcela', hostname: 'reports.example.invalid', porta: '443',
      expiracao: '2026-10-22T12:00:00.000Z', correlacao: 'PENDENTE' }] })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
  it.each([{ fundoId: other }, { endpointId: other }, { ambiente: 'homologacao' },
    { codigoCarteira: 'another-wallet' }, { hash: '0'.repeat(64) }, { purpose: 'ANOTHER_PURPOSE' }])('rejects wrong encrypted scope %j', async change => {
    const response = await inspecionarHostsPreservados(request(), { env, now, ler: vi.fn().mockResolvedValue([row(change)]) })
    expect(response.status).toBe(503); expect(await response.text()).toBe('')
  })
  it.each(['fundo', 'id', 'hash', 'ciphertext', 'missing', 'exception'])('fails closed on %s without echoing source or errors', async failure => {
    const value = row()
    if (failure === 'fundo') value.fundo_id = other
    if (failure === 'id') value.id = other
    if (failure === 'hash') value.hash_evento = '0'.repeat(64)
    if (failure === 'ciphertext') value.payload_criptografado = 'v1:corrupted'
    const ler = failure === 'exception' ? vi.fn().mockRejectedValue(new Error('private-source-exception'))
      : vi.fn().mockResolvedValue(failure === 'missing' ? [] : [value])
    const response = await inspecionarHostsPreservados(request(), { env, now, ler })
    expect(response.status).toBe(503); expect(await response.text()).toBe('')
  })
})
