import { afterEach, describe, expect, it, vi } from 'vitest'
import { prazoCapturaCallback, prepararDiagnosticoCallback } from './relatorios-callback-diagnostic'
import { receberCallbackRelatorio, type CallbackRepository } from './relatorios-callback-handler.server'
import { criarRepositorioDiagnosticoHistorico as criarRepositorioCallbackRelatorio } from '@/test/vortx-callback-diagnostic-repository'
import { descriptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const token = 'a'.repeat(64)
const binding = { endpointId: id, fundoId: id, ambiente: 'producao' as const, codigoCarteira: 'qa-wallet', revisao: 1 }
const now = Date.parse('2026-10-20T14:00:00Z')
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/vortx-real-data-preview',
  NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co', VORTX_REPORTS_PREVIEW_ENABLED: 'true',
  VORTX_REPORTS_PREVIEW_FUNDO_ID: id, VORTX_REPORT_CALLBACK_PREVIEW_ENABLED: 'true',
  VORTX_REPORT_CALLBACK_URL_RISK_ACCEPTED: 'true', VORTX_REPORT_CALLBACK_CAPTURE_UNTIL: '2026-10-21T13:00:00Z' }
const invalid = { idCarteira: binding.codigoCarteira, statusRelatorio: 'unexpected', urlRelatorio: 'https://example.invalid/report?signed=synthetic' }
const rejection = { motivo: 'CONTRATO_INVALIDO' as const, corpo: JSON.stringify(invalid), bytes: 120 }
const request = (body = rejection.corpo, query = `endpoint=${id}&token=${token}`, headers = {}) =>
  new Request(`https://example.invalid/callback?${query}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
const repo = (): CallbackRepository => ({ autorizar: vi.fn().mockResolvedValue({ status: 'AUTHORIZED', ...binding }),
  persistir: vi.fn(), diagnosticarRejeicao: vi.fn().mockResolvedValue(undefined) })

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers() })
function enable() {
  vi.useFakeTimers(); vi.setSystemTime(now)
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  vi.stubEnv('PORTAL_FIDC_CREDENTIAL_KEYS_JSON', JSON.stringify({ qa: 'b'.repeat(64) }))
  vi.stubEnv('PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION', 'qa')
}

describe('historical synthetic temporary diagnostics (retired from application)', () => {
  it('requires an explicit short-lived window in the exact allowed Preview', () => {
    expect(prazoCapturaCallback({}, now)).toBeNull()
    expect(prazoCapturaCallback(env, now)).toBe('2026-10-21T13:00:00.000Z')
  })
  it.each(['', 'invalid', '2026-10-20T13:00:00Z', '2026-10-22T14:00:00Z', '2026-10-21'])('fails closed for deadline %s', value => {
    expect(prazoCapturaCallback({ ...env, VORTX_REPORT_CALLBACK_CAPTURE_UNTIL: value }, now)).toBeNull()
  })
  it.each(Object.keys(env).filter(key => key !== 'VORTX_REPORT_CALLBACK_CAPTURE_UNTIL'))('does not override %s scope', key => {
    expect(prazoCapturaCallback({ ...env, [key]: 'other' }, now)).toBeNull()
  })
  it('redacts the callback token even when echoed inside the body and scopes deduplication to revision', () => {
    const first = prepararDiagnosticoCallback(binding, { ...rejection, corpo: JSON.stringify({ echoed: token }) }, token)
    expect(JSON.stringify(first)).not.toContain(token)
    expect(first.envelope.corpo).toContain('[CALLBACK_TOKEN_REDACTED]')
    expect(first.hash).not.toBe(prepararDiagnosticoCallback({ ...binding, revisao: 2 }, rejection, token).hash)
  })
  it.each([['{', 'JSON_INVALIDO'], [rejection.corpo, 'CONTRATO_INVALIDO']])('captures bounded authenticated rejection %s, still returns 400', async (body, motivo) => {
    const repository = repo()
    const response = await receberCallbackRelatorio(request(body), repository, id)
    expect(response.status).toBe(400); expect(await response.text()).toBe('')
    expect(repository.diagnosticarRejeicao).toHaveBeenCalledWith({ status: 'AUTHORIZED', ...binding }, expect.any(String), { motivo, corpo: body, bytes: Buffer.byteLength(body) }, token)
    expect(repository.persistir).not.toHaveBeenCalled()
  })
  it('keeps the rejection and reports only a safe diagnostic failure if saving fails', async () => {
    const repository = repo(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(repository.diagnosticarRejeicao!).mockRejectedValue(new Error(`${token} ${invalid.urlRelatorio}`))
    expect((await receberCallbackRelatorio(request(), repository, id)).status).toBe(400)
    expect(warn).toHaveBeenCalledExactlyOnceWith('vortx_callback_diagnostic', { estado: 'FALHA_CAPTURA' })
  })
  it('never captures missing/invalid authorization, rate limit or another Fund', async () => {
    for (const status of ['UNAUTHORIZED', 'RATE_LIMITED'] as const) {
      const repository = repo(); vi.mocked(repository.autorizar).mockResolvedValue({ status })
      await receberCallbackRelatorio(request(), repository, id)
      expect(repository.diagnosticarRejeicao).not.toHaveBeenCalled()
    }
    const repository = repo()
    await receberCallbackRelatorio(request(undefined, ''), repository, id)
    await receberCallbackRelatorio(request(), repository, other)
    expect(repository.diagnosticarRejeicao).not.toHaveBeenCalled()
  })
  it('never captures a known cross-wallet payload, oversized body or unsupported content', async () => {
    const repository = repo()
    await receberCallbackRelatorio(request(JSON.stringify({ ...invalid, idCarteira: 'another-wallet' })), repository, id)
    await receberCallbackRelatorio(request('x'.repeat(17000)), repository, id)
    await receberCallbackRelatorio(request(undefined, undefined, { 'content-type': 'text/plain' }), repository, id)
    expect(repository.diagnosticarRejeicao).not.toHaveBeenCalled()
  })
  it('does not write diagnostics by default', async () => {
    vi.stubEnv('VORTX_REPORT_CALLBACK_CAPTURE_UNTIL', '')
    const rpc = vi.fn()
    const repository = criarRepositorioCallbackRelatorio({ rpc } as unknown as Parameters<typeof criarRepositorioCallbackRelatorio>[0])
    await repository.diagnosticarRejeicao!(binding, 'synthetic-hash', rejection, token)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('encrypts the actual rejected JSON and never includes plaintext URL or token in RPC data', async () => {
    enable()
    const rpc = vi.fn().mockResolvedValue({ data: { estado: 'SALVO' }, error: null })
    const repository = criarRepositorioCallbackRelatorio({ rpc } as unknown as Parameters<typeof criarRepositorioCallbackRelatorio>[0])
    await repository.diagnosticarRejeicao!(binding, 'synthetic-hash', rejection, token)
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('vortx_registrar_callback_rejeitado')
    expect(JSON.stringify(args)).not.toContain(invalid.urlRelatorio); expect(JSON.stringify(args)).not.toContain(token)
    const envelope = JSON.parse(descriptografarPortalFidcValor(args.p_ciphertext, args.p_chave_versao))
    expect(envelope).toMatchObject({ purpose: 'VORTX_CALLBACK_REJEITADO_V1', fundoId: id, ...rejection })
    expect(() => descriptografarPortalFidcValor(args.p_ciphertext.slice(0, -4) + 'xxxx', 'qa')).toThrow()
  })
  it('has no plaintext fallback when encryption is unavailable', async () => {
    enable(); vi.stubEnv('PORTAL_FIDC_CREDENTIAL_KEYS_JSON', '{}')
    const rpc = vi.fn()
    const repository = criarRepositorioCallbackRelatorio({ rpc } as unknown as Parameters<typeof criarRepositorioCallbackRelatorio>[0])
    await expect(repository.diagnosticarRejeicao!(binding, 'synthetic-hash', rejection, token)).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([null, { estado: 'UNKNOWN' }])('does not fabricate capture evidence for %s', async data => {
    enable()
    const rpc = vi.fn().mockResolvedValue({ data, error: null })
    const repository = criarRepositorioCallbackRelatorio({ rpc } as unknown as Parameters<typeof criarRepositorioCallbackRelatorio>[0])
    await expect(repository.diagnosticarRejeicao!(binding, 'synthetic-hash', rejection, token)).rejects.toThrow('diagnostico privado')
  })
})
