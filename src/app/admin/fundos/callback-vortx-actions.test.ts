import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ contexto: vi.fn(), mfa: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/integracoes/vortx/relatorios-contexto.server', () => ({ carregarContextoRelatorios: mocks.contexto }))
vi.mock('@/lib/auth/sensitive-action', () => ({ autorizarEConsumirAcaoSensivel: mocks.mfa }))
import { alterarCallbackVortx, obterCallbackVortx } from './callback-vortx-actions'
import { AuthorizationError } from '@/lib/auth/authorization'
import { callbackActionSchema, situacaoCallback, type CallbackStatus } from '@/lib/integracoes/vortx/callback-admin'
import { montarUrlCallback, origemCallback } from '@/lib/integracoes/vortx/callback-admin.server'
import { hashSegredoCallback } from '@/lib/integracoes/vortx/relatorios-callback'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const status: CallbackStatus = { id, revisao: 1, ativo: true, carteira: 'qa-wallet', ambiente: 'producao', geradaEm: '2026-10-19T20:00:00Z', cadastroInformadoEm: null, ultimoEventoEm: null }
const input = { fundoId: id, versaoId: version, acao: 'gerar', revisao: 0, mfaCode: '123456' }
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/vortx-real-data-preview', NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co',
  VORTX_REPORTS_PREVIEW_ENABLED: 'true', VORTX_REPORTS_PREVIEW_FUNDO_ID: id, VORTX_REPORT_CALLBACK_PREVIEW_ENABLED: 'true', VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED: 'true',
  VERCEL_BRANCH_URL: 'qa-branch.example.vercel.app', VORTX_REPORT_CALLBACK_BASE_URL: 'https://qa-branch.example.vercel.app' }
const auth = { user: { id }, supabase: { rpc: mocks.rpc } }
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  vi.stubEnv('VORTX_REPORT_CALLBACK_URL_RISK_ACCEPTED', 'false')
  mocks.contexto.mockResolvedValue({ auth, contexto: { versoes: [{ id: version }] } })
  mocks.mfa.mockResolvedValue({ nonceHash: 'c'.repeat(64) })
  mocks.rpc.mockResolvedValue({ data: status, error: null })
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('callback operator actions', () => {
  it('generates server-side secret, consumes canonical TOTP transactionally, returns URL only once', async () => {
    const response = await alterarCallbackVortx(input)
    expect(response.success).toBe(true)
    if (!response.success || !response.urlUnica) throw new Error('missing one-time URL')
    const url = new URL(response.urlUnica), token = url.searchParams.get('token')!
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(url.origin).toBe(env.VORTX_REPORT_CALLBACK_BASE_URL)
    expect(url.pathname).toBe('/api/integracoes/vortx/relatorios/callback')
    expect(url.searchParams.get('endpoint')).toBe(id)
    expect(mocks.mfa).toHaveBeenCalledWith(auth, 'configurar_credencial_vortx_vrs', input.mfaCode, { consumoTransacional: true })
    expect(mocks.rpc).toHaveBeenCalledWith('admin_vortx_callback_mutar', { p_fundo_id: id, p_versao_id: version, p_acao: 'gerar', p_revisao_esperada: 0, p_segredo_hash: hashSegredoCallback(token), p_nonce_hash: 'c'.repeat(64) })
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token)
    expect(JSON.stringify(response)).not.toMatch(/123456|nonceHash|segredo_hash/)
  })
  it.each(['URL', 'token', 'ambiente', 'codigoCarteira', 'host', 'segredo_hash'])('rejects client-supplied %s before auth', async key => {
    expect(callbackActionSchema.safeParse({ ...input, [key]: 'arbitrary' }).success).toBe(false)
    expect(await alterarCallbackVortx({ ...input, [key]: 'arbitrary' })).toMatchObject({ success: false })
    expect(mocks.contexto).not.toHaveBeenCalled()
  })
  it('has no service/admin client in the operator path and no URL in read DTO', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...status, segredo_hash: 'private', urlUnica: 'private' }, error: null })
    const response = await obterCallbackVortx({ fundoId: id, versaoId: version })
    expect(response.success).toBe(true); expect(JSON.stringify(response)).not.toMatch(/private|urlUnica|segredo_hash/)
    expect(mocks.mfa).not.toHaveBeenCalled()
  })
  it.each(['VORTX_REPORT_CALLBACK_PREVIEW_ENABLED', 'VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED', 'VORTX_REPORT_CALLBACK_BASE_URL'])('blocks generation without readiness %s', async key => {
    vi.stubEnv(key, '')
    expect(await alterarCallbackVortx(input)).toMatchObject({ success: false }); expect(mocks.mfa).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('still permits emergency revocation when receiving is disabled', async () => {
    vi.stubEnv('VORTX_REPORT_CALLBACK_PREVIEW_ENABLED', 'false')
    const response = await alterarCallbackVortx({ ...input, acao: 'revogar', revisao: 1 })
    expect(response).toMatchObject({ success: true, habilitado: false }); expect(response).not.toHaveProperty('urlUnica')
    expect(mocks.rpc.mock.calls[0][1].p_segredo_hash).toBeNull()
  })
  it('denies foreign version or failed authorization before MFA/mutation', async () => {
    expect(await alterarCallbackVortx({ ...input, versaoId: id })).toMatchObject({ success: false })
    mocks.contexto.mockRejectedValue(new AuthorizationError('Sem vínculo', 'FORBIDDEN'))
    expect(await alterarCallbackVortx(input)).toEqual({ success: false, message: 'Sem vínculo' }); expect(mocks.mfa).not.toHaveBeenCalled()
  })
  it('failed TOTP never reaches mutation', async () => {
    mocks.mfa.mockRejectedValue(new AuthorizationError('TOTP inválido', 'FORBIDDEN'))
    expect(await alterarCallbackVortx(input)).toEqual({ success: false, message: 'TOTP inválido' }); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('explicit risk exception enables generation but preserves the canonical MFA and safe warning', async () => {
    vi.stubEnv('VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED', 'false')
    vi.stubEnv('VORTX_REPORT_CALLBACK_URL_RISK_ACCEPTED', 'true')
    const result = await alterarCallbackVortx(input)
    expect(result).toMatchObject({ success: true, habilitado: true, avisoRisco: expect.stringContaining('mascaramento não foi comprovado') })
    expect(mocks.mfa).toHaveBeenCalledWith(auth, 'configurar_credencial_vortx_vrs', input.mfaCode, { consumoTransacional: true })
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
  it('risk acceptance does not bypass failed TOTP', async () => {
    vi.stubEnv('VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED', 'false')
    vi.stubEnv('VORTX_REPORT_CALLBACK_URL_RISK_ACCEPTED', 'true')
    mocks.mfa.mockRejectedValue(new AuthorizationError('TOTP inválido', 'FORBIDDEN'))
    expect(await alterarCallbackVortx(input)).toEqual({ success: false, message: 'TOTP inválido' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not show a risk exception warning on the verified path', async () => {
    expect(await obterCallbackVortx({ fundoId: id, versaoId: version })).toMatchObject({ success: true, habilitado: true, avisoRisco: null })
  })
  it('handles concurrent change and infrastructure error without leaking backend details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'sql secret' } })
    expect(await alterarCallbackVortx(input)).toMatchObject({ success: false, message: expect.stringContaining('outra sessão') })
    mocks.rpc.mockRejectedValue(new Error('sql secret'))
    expect(JSON.stringify(await alterarCallbackVortx(input))).not.toContain('sql secret')
  })
  it.each(['http://qa-branch.example.vercel.app', 'https://other.example.vercel.app', 'https://qa-branch.example.vercel.app/path', 'https://user:pass@qa-branch.example.vercel.app', 'https://qa-branch.example.vercel.app?token=private'])('rejects unsafe or arbitrary callback origin %s', url => {
    expect(origemCallback({ ...env, VORTX_REPORT_CALLBACK_BASE_URL: url })).toBeNull()
    expect(() => montarUrlCallback(id, 'a'.repeat(64), { ...env, VORTX_REPORT_CALLBACK_BASE_URL: url })).toThrow()
  })
  it('does not treat operator registration as successful provider delivery', () => {
    expect(situacaoCallback({ ...status, id: null, revisao: 0 })).toBe('URL não gerada')
    expect(situacaoCallback(status)).toBe('Aguardando cadastro na Vórtx')
    expect(situacaoCallback({ ...status, cadastroInformadoEm: status.geradaEm })).toBe('Aguardando primeiro evento')
    expect(situacaoCallback({ ...status, ultimoEventoEm: status.geradaEm })).toBe('Evento recebido')
    expect(situacaoCallback({ ...status, ativo: false, ultimoEventoEm: status.geradaEm })).toBe('Recebimento revogado')
  })
})
