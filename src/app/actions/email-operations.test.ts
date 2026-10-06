import { createClient as createSupabaseClient, type User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database, UserRole } from '@/types/database'
import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/auth/authorization'
import { requireSessaoMfaValida } from '@/lib/auth/mfa'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { criptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import { criarCredencialEmail } from './email-operations'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/auth/mfa', () => ({ requireSessaoMfaValida: vi.fn() }))
vi.mock('@/lib/auth/sensitive-action', () => ({ autorizarEConsumirAcaoSensivel: vi.fn() }))
vi.mock('@/lib/portal-fidc/credenciais', () => ({ criptografarPortalFidcValor: vi.fn() }))
vi.mock('@/lib/email-intake/operations/credentials.server', () => ({ testEmailMailbox: vi.fn() }))
vi.mock('@/lib/email-intake/operations/metadata.server', () => ({ refreshEmailMetadata: vi.fn() }))

const user: User = {
  id: '11111111-1111-4111-8111-111111111111', app_metadata: {}, user_metadata: {},
  aud: 'authenticated', created_at: '2026-10-06T12:00:00Z',
}
const credentialId = '22222222-2222-4222-8222-222222222222'
const input = {
  requestId: '33333333-3333-4333-8333-333333333333',
  fundoId: '44444444-4444-4444-8444-444444444444', name: 'QA Outlook', environment: 'homologacao',
  tenantId: '55555555-5555-4555-8555-555555555555',
  clientId: '66666666-6666-4666-8666-666666666666', clientSecret: 'synthetic-test-secret', mfaCode: '123456',
}

let primaryRole: UserRole
let activeRoles: UserRole[]
let roleQueryFailed: boolean
let sessionExpired: boolean
let credentialDenied: boolean
let credentialRequests: unknown[]
let roleQueries: URL[]

beforeEach(() => {
  vi.resetAllMocks()
  primaryRole = 'gestor'
  activeRoles = ['gestor', 'super_admin']
  roleQueryFailed = sessionExpired = credentialDenied = false
  credentialRequests = []
  roleQueries = []
  const client = createSupabaseClient<Database>('https://email-auth-test.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (request, init) => {
        const url = new URL(String(request))
        if (url.pathname === '/rest/v1/profiles') return Response.json([{
          id: user.id, role: primaryRole, status: 'ativo', nome_completo: 'QA', email: 'qa@example.test',
          mfa_obrigatorio_override: null, mfa_ativado_em: null,
          ultima_autenticacao_forte_em: null, senha_alterada_em: null,
        }])
        if (url.pathname === '/rest/v1/usuario_papeis') {
          roleQueries.push(url)
          return roleQueryFailed
            ? Response.json({ code: '42501', message: 'test role query denied' }, { status: 403 })
            : Response.json(activeRoles.map(papel => ({ papel })))
        }
        if (url.pathname === '/rest/v1/rpc/obter_sessao_mfa_atual') {
          return Response.json([{ status: sessionExpired ? 'expired' : 'valid' }])
        }
        if (url.pathname === '/rest/v1/rpc/email_operator_create_credential') {
          credentialRequests.push(JSON.parse(String(init?.body)))
          return credentialDenied
            ? Response.json({ code: '42501', message: 'EMAIL_ACCESS_DENIED' }, { status: 403 })
            : Response.json(credentialId)
        }
        throw new Error(`Unexpected test request: ${url.pathname}`)
      },
    },
  })
  vi.spyOn(client.auth, 'getUser').mockResolvedValue({ data: { user }, error: null })
  vi.mocked(createClient).mockResolvedValue(client)
  vi.mocked(criptografarPortalFidcValor)
    .mockReturnValueOnce({ ciphertext: 'encrypted-identity', chaveVersao: 'qa-v1' })
    .mockReturnValueOnce({ ciphertext: 'encrypted-secret', chaveVersao: 'qa-v1' })
})

function expectNoCredentialWrite() {
  expect(credentialRequests).toEqual([])
  expect(criptografarPortalFidcValor).not.toHaveBeenCalled()
  expect(revalidatePath).not.toHaveBeenCalled()
  expect(createAdminClient).not.toHaveBeenCalled()
}

describe('cadastro de credencial de email com autorização administrativa canônica', () => {
  it.each(['gestor', 'super_admin'] as const)('permite %s com Super Admin ativo e preserva MFA, fundo e criptografia', async role => {
    primaryRole = role
    expect(await criarCredencialEmail(input)).toEqual({ ok: true, data: { id: credentialId } })
    expect(roleQueries).toHaveLength(1)
    expect(roleQueries[0].searchParams.get('usuario_id')).toBe(`eq.${user.id}`)
    expect(roleQueries[0].searchParams.get('ativo')).toBe('eq.true')
    expect(requireSessaoMfaValida).toHaveBeenCalled()
    expect(autorizarEConsumirAcaoSensivel).toHaveBeenCalledWith(
      expect.objectContaining({ user, profile: expect.objectContaining({ role }) }),
      'cadastrar_credencial_integracao', input.mfaCode,
    )
    expect(credentialRequests).toEqual([{
      p_fundo: input.fundoId, p_name: input.name, p_environment: input.environment,
      p_identity_cipher: 'encrypted-identity', p_secret_cipher: 'encrypted-secret',
      p_key_version: 'qa-v1', p_request: input.requestId,
    }])
    expect(revalidatePath).toHaveBeenCalledWith('/admin/integracoes-email')
    expect(revalidatePath).toHaveBeenCalledWith('/gestor/integracoes-email')
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it.each(['gestor', 'super_admin'] as const)('recusa %s sem papel administrativo ativo, mesmo após revogação', async role => {
    primaryRole = role
    activeRoles = ['gestor']
    expect(await criarCredencialEmail(input)).toMatchObject({ ok: false, message: 'Acesso restrito a administradores da plataforma.' })
    expect(autorizarEConsumirAcaoSensivel).not.toHaveBeenCalled()
    expectNoCredentialWrite()
  })

  it('falha de forma fechada quando os papéis não podem ser consultados', async () => {
    roleQueryFailed = true
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await criarCredencialEmail(input)).toMatchObject({ ok: false, message: 'Nao foi possivel validar o acesso administrativo.' })
      expect(autorizarEConsumirAcaoSensivel).not.toHaveBeenCalled()
      expectNoCredentialWrite()
    } finally { diagnostic.mockRestore() }
  })

  it('recusa sessão MFA expirada antes de criar a credencial', async () => {
    sessionExpired = true
    expect(await criarCredencialEmail(input)).toMatchObject({ ok: false, message: expect.stringContaining('expirou') })
    expect(autorizarEConsumirAcaoSensivel).not.toHaveBeenCalled()
    expectNoCredentialWrite()
  })

  it('recusa confirmação MFA inválida antes de criptografar ou persistir', async () => {
    vi.mocked(autorizarEConsumirAcaoSensivel).mockRejectedValue(new AuthorizationError('Código TOTP inválido.', 'FORBIDDEN'))
    expect(await criarCredencialEmail(input)).toEqual({ ok: false, message: 'Código TOTP inválido.' })
    expectNoCredentialWrite()
  })

  it('mantém a recusa do fundo na RPC autenticada e não retorna segredos', async () => {
    credentialDenied = true
    const result = await criarCredencialEmail(input)
    expect(result).toEqual({ ok: false, message: 'Seu acesso ou a confirmação MFA não permite esta ação. Confirme o fundo e entre novamente se necessário.' })
    expect(credentialRequests).toHaveLength(1)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain(input.clientSecret)
  })
})
