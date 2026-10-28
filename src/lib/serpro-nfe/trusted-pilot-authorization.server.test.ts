import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  requireSessaoMfaValida: vi.fn(),
  listarPapeisAtivosUsuario: vi.fn(),
  verificarRateLimit: vi.fn(),
  registrarTentativaRateLimit: vi.fn(),
  registrarEventoSeguranca: vi.fn(),
  createAdminClient: vi.fn(),
  runPilot: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/authorization', () => ({
  AuthorizationError: class AuthorizationError extends Error {},
  requireAuthenticated: mocks.requireAuthenticated,
}))
vi.mock('@/lib/auth/mfa', () => ({
  requireSessaoMfaValida: mocks.requireSessaoMfaValida,
  sanitizarCodigoTotp: (value: string) => value.replace(/\D/g, '').slice(0, 6),
  validarFormatoCodigoTotp: (value: string) => /^\d{6}$/.test(value),
  registrarEventoSeguranca: mocks.registrarEventoSeguranca,
}))
vi.mock('@/lib/auth/platform-access', () => ({
  listarPapeisAtivosUsuario: mocks.listarPapeisAtivosUsuario,
}))
vi.mock('@/lib/security/rate-limit', () => ({
  verificarRateLimit: mocks.verificarRateLimit,
  registrarTentativaRateLimit: mocks.registrarTentativaRateLimit,
}))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock('./pilot-worker.server', () => ({
  runSerproNfePilotOnce: mocks.runPilot,
}))

import {
  authorizeSerproNfePilotManual,
  TrustedPilotAuthorizationError,
} from './trusted-pilot-authorization.server'

const ids = {
  user: 'a1000000-0000-4000-8000-000000000001',
  session: 'a2000000-0000-4000-8000-000000000001',
  fund: 'a3000000-0000-4000-8000-000000000001',
  note: 'a4000000-0000-4000-8000-000000000001',
  consultation: 'a5000000-0000-4000-8000-000000000001',
  snapshot: 'a6000000-0000-4000-8000-000000000001',
  authorization: 'a7000000-0000-4000-8000-000000000001',
}

const key = '35261014224864000100550020000021901123456788'
const request = {
  fundoId: ids.fund,
  notaFiscalId: ids.note,
  consultaId: ids.consultation,
  codigoTotp: '123456',
}

type SessionOptions = {
  fundLink?: boolean
  consultation?: Record<string, unknown> | null
  snapshot?: Record<string, unknown> | null
  factors?: Array<Record<string, unknown>>
  verifyError?: { message: string } | null
  aal?: string
}

function query(data: unknown, error: { message: string } | null = null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data, error })),
  }
  return builder
}

function sessionClient(options: SessionOptions = {}) {
  const consultation = options.consultation === undefined ? {
    id: ids.consultation,
    snapshot_id: ids.snapshot,
    fundo_id: ids.fund,
    nota_fiscal_id: ids.note,
    status: 'PENDENTE',
    capability_state: 'ENABLED',
    lease_token: null,
    lease_ate: null,
  } : options.consultation
  const snapshot = options.snapshot === undefined ? {
    id: ids.snapshot,
    fundo_id: ids.fund,
    nota_fiscal_id: ids.note,
    modelo: '55',
    chave_acesso: key,
  } : options.snapshot
  const tables = {
    usuario_fundos: query(options.fundLink === false ? null : { id: 'link' }),
    nfe_fiscal_consultas: query(consultation),
    nfe_fiscal_snapshots: query(snapshot),
  }
  const from = vi.fn((name: keyof typeof tables) => tables[name])
  const mfa = {
    listFactors: vi.fn(async () => ({
      data: { totp: options.factors ?? [{ id: 'factor-1', status: 'verified', factor_type: 'totp' }] },
      error: null,
    })),
    challenge: vi.fn(async () => ({ data: { id: 'challenge-1' }, error: null })),
    verify: vi.fn(async () => ({ data: {}, error: options.verifyError ?? null })),
    getAuthenticatorAssuranceLevel: vi.fn(async () => ({
      data: { currentLevel: options.aal ?? 'aal2', nextLevel: 'aal2' },
      error: null,
    })),
  }
  return { auth: { mfa }, from, tables, mfa }
}

function context(client: ReturnType<typeof sessionClient>, role = 'gestor') {
  return {
    supabase: client,
    user: { id: ids.user },
    profile: { id: ids.user, role, status: 'ativo' },
  }
}

function adminClient(options: { authorizeError?: { message: string } | null; auditError?: { message: string } | null } = {}) {
  const insert = vi.fn(async () => ({ error: options.auditError ?? null }))
  const rpc = vi.fn(async () => ({
    data: options.authorizeError ? null : ids.authorization,
    error: options.authorizeError ?? null,
  }))
  return { from: vi.fn(() => ({ insert })), rpc, insert }
}

beforeEach(() => {
  vi.clearAllMocks()
  const client = sessionClient()
  mocks.requireAuthenticated.mockResolvedValue(context(client))
  mocks.requireSessaoMfaValida.mockResolvedValue({ sessaoId: ids.session })
  mocks.listarPapeisAtivosUsuario.mockResolvedValue(['gestor'])
  mocks.verificarRateLimit.mockResolvedValue({ allowed: true, remaining: 5, blockedUntil: null })
  mocks.registrarTentativaRateLimit.mockResolvedValue(undefined)
  mocks.registrarEventoSeguranca.mockResolvedValue(undefined)
  mocks.createAdminClient.mockReturnValue(adminClient())
  mocks.runPilot.mockResolvedValue({ processed: 0, skipped: 'CAPABILITY_UNVERIFIED' })
})

describe('autorizacao manual confiavel do piloto SERPRO', () => {
  it('deriva operador, sessao, chave e nonce no servidor e cria handle nao serializavel', async () => {
    const handle = await authorizeSerproNfePilotManual(request)
    const admin = mocks.createAdminClient.mock.results[0].value as ReturnType<typeof adminClient>

    expect(admin.rpc).toHaveBeenCalledWith('nfe_fiscal_pilot_authorize', expect.objectContaining({
      p_consulta_id: ids.consultation,
      p_fundo_id: ids.fund,
      p_nota_fiscal_id: ids.note,
      p_chave_acesso: key,
      p_operador_id: ids.user,
      p_operador_session_id: ids.session,
      p_nonce_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_expira_em: expect.any(String),
    }))
    expect(JSON.stringify(handle)).toBe('{"status":"SERVER_ONLY_HANDLE"}')
    expect(JSON.stringify(handle)).not.toContain(ids.authorization)
    expect(JSON.stringify(handle)).not.toContain(key)
    expect(JSON.stringify(handle)).not.toContain(ids.session)
  })

  it('consome o handle exatamente uma vez e nao expoe o envelope ao chamador', async () => {
    const handle = await authorizeSerproNfePilotManual(request)
    await expect(handle.consume()).resolves.toEqual({ processed: 0, skipped: 'CAPABILITY_UNVERIFIED' })
    await expect(handle.consume()).resolves.toEqual({ processed: 0, skipped: 'PILOT_HANDLE_ALREADY_USED' })
    expect(mocks.runPilot).toHaveBeenCalledTimes(1)
    expect(mocks.runPilot).toHaveBeenCalledWith(expect.objectContaining({
      authorizationId: ids.authorization,
      consultaId: ids.consultation,
      fundoId: ids.fund,
      notaFiscalId: ids.note,
      chaveAcesso: key,
      operadorId: ids.user,
      nonceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
  })

  it.each(['cedente', 'consultor', 'sacado'])(
    'nega perfil %s antes de criar cliente privilegiado',
    async role => {
      const client = sessionClient()
      mocks.requireAuthenticated.mockResolvedValue(context(client, role))
      mocks.listarPapeisAtivosUsuario.mockResolvedValue([role])

      await expect(authorizeSerproNfePilotManual(request)).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
      expect(mocks.createAdminClient).not.toHaveBeenCalled()
      expect(client.mfa.challenge).not.toHaveBeenCalled()
    },
  )

  it('aceita Super Admin canonico sem inventar vinculo de Fundo', async () => {
    const client = sessionClient({ fundLink: false })
    mocks.requireAuthenticated.mockResolvedValue(context(client, 'gestor'))
    mocks.listarPapeisAtivosUsuario.mockResolvedValue(['gestor', 'super_admin'])

    await expect(authorizeSerproNfePilotManual(request)).resolves.toBeDefined()
    expect(client.from).not.toHaveBeenCalledWith('usuario_fundos')
  })

  it('nega Gestor sem vinculo ativo com o Fundo e nao revela o alvo', async () => {
    const client = sessionClient({ fundLink: false })
    mocks.requireAuthenticated.mockResolvedValue(context(client))

    const error = await authorizeSerproNfePilotManual(request).catch(value => value)
    expect(error).toMatchObject({ code: 'ACCESS_DENIED' })
    expect(String(error.message)).not.toContain(ids.fund)
    expect(String(error.message)).not.toContain(ids.note)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it.each([
    ['sessao expirada', () => mocks.requireSessaoMfaValida.mockRejectedValue(new Error('expired'))],
    ['sessao revogada', () => mocks.requireSessaoMfaValida.mockRejectedValue(new Error('revoked'))],
    ['troca de sessao', () => mocks.requireSessaoMfaValida.mockRejectedValue(new Error('session_mismatch'))],
    ['fator nao verificado', () => {
      const client = sessionClient({ factors: [{ id: 'factor-1', status: 'unverified' }] })
      mocks.requireAuthenticated.mockResolvedValue(context(client))
    }],
    ['TOTP vencido ou reutilizado', () => {
      const client = sessionClient({ verifyError: { message: 'invalid' } })
      mocks.requireAuthenticated.mockResolvedValue(context(client))
    }],
    ['AAL1', () => {
      const client = sessionClient({ aal: 'aal1' })
      mocks.requireAuthenticated.mockResolvedValue(context(client))
    }],
  ])('nega %s sem chamar a RPC privilegiada', async (_label, arrange) => {
    arrange()
    await expect(authorizeSerproNfePilotManual(request)).rejects.toBeDefined()
    const adminCalls = mocks.createAdminClient.mock.results
      .map(result => result.value as ReturnType<typeof adminClient>)
      .flatMap(client => client?.rpc?.mock.calls || [])
    expect(adminCalls).toHaveLength(0)
  })

  it('nega TOTP malformado antes de criar challenge ou cliente privilegiado', async () => {
    const client = sessionClient()
    mocks.requireAuthenticated.mockResolvedValue(context(client))

    await expect(authorizeSerproNfePilotManual({ ...request, codigoTotp: '12ab' }))
      .rejects.toMatchObject({ code: 'MFA_DENIED' })
    expect(client.mfa.challenge).not.toHaveBeenCalled()
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('nega quando o rate limit de MFA sensivel esta esgotado', async () => {
    const client = sessionClient()
    mocks.requireAuthenticated.mockResolvedValue(context(client))
    mocks.verificarRateLimit.mockResolvedValue({ allowed: false, remaining: 0, blockedUntil: new Date() })

    await expect(authorizeSerproNfePilotManual(request)).rejects.toMatchObject({ code: 'MFA_DENIED' })
    expect(client.mfa.challenge).not.toHaveBeenCalled()
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it.each([
    ['consulta de outro Fundo', { consultation: null }],
    ['modelo diferente de 55', { snapshot: {
      id: ids.snapshot, fundo_id: ids.fund, nota_fiscal_id: ids.note, modelo: '65', chave_acesso: key,
    } }],
    ['consulta ja processada', { consultation: {
      id: ids.consultation, snapshot_id: ids.snapshot, fundo_id: ids.fund, nota_fiscal_id: ids.note,
      status: 'CONSULTADO', capability_state: 'ENABLED', lease_token: null, lease_ate: null,
    } }],
  ])('nega alvo inconsistente: %s', async (_label, options) => {
    const client = sessionClient(options)
    mocks.requireAuthenticated.mockResolvedValue(context(client))

    await expect(authorizeSerproNfePilotManual(request)).rejects.toMatchObject({ code: 'TARGET_NOT_ELIGIBLE' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('nega provider, entitlement ou custo nao aprovados sem propagar erro do banco', async () => {
    const admin = adminClient({ authorizeError: { message: `budget denied ${ids.note} ${key}` } })
    mocks.createAdminClient.mockReturnValue(admin)

    const error = await authorizeSerproNfePilotManual(request).catch(value => value)
    expect(error).toBeInstanceOf(TrustedPilotAuthorizationError)
    expect(error).toMatchObject({ code: 'AUTHORIZATION_REJECTED' })
    expect(String(error.message)).not.toContain(ids.note)
    expect(String(error.message)).not.toContain(key)
    expect(mocks.runPilot).not.toHaveBeenCalled()
    expect(admin.insert).toHaveBeenCalledTimes(2)
  })

  it('falha fechado se a auditoria minima nao puder ser registrada', async () => {
    const admin = adminClient({ auditError: { message: 'audit unavailable' } })
    mocks.createAdminClient.mockReturnValue(admin)

    await expect(authorizeSerproNfePilotManual(request)).rejects.toMatchObject({ code: 'AUDIT_UNAVAILABLE' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('audita somente IDs e fingerprint, sem TOTP, chave, sessao ou nonce', async () => {
    await authorizeSerproNfePilotManual(request)
    const admin = mocks.createAdminClient.mock.results[0].value as ReturnType<typeof adminClient>
    const auditCalls = admin.insert.mock.calls as unknown as Array<[Record<string, unknown>]>
    const auditPayloads = auditCalls.map(call => call[0])
    const serialized = JSON.stringify(auditPayloads)

    expect(auditPayloads).toHaveLength(2)
    expect(serialized).toContain(ids.fund)
    expect(serialized).toContain(ids.note)
    expect(serialized).toMatch(/[0-9a-f]{64}/)
    expect(serialized).not.toContain(request.codigoTotp)
    expect(serialized).not.toContain(key)
    expect(serialized).not.toContain(ids.session)
    expect(serialized).not.toContain(ids.authorization)
  })

  it.each(['sem login', 'JWT adulterado', 'JWT expirado', 'JWT revogado', 'usuario inativo'])(
    'autentica antes de validar IDs e fecha %s sem cliente privilegiado',
    async reason => {
      mocks.requireAuthenticated.mockRejectedValue(new Error(reason))
      const malformed = { ...request, fundoId: 'not-a-uuid' }

      await expect(authorizeSerproNfePilotManual(malformed)).rejects.toThrow(reason)
      expect(mocks.createAdminClient).not.toHaveBeenCalled()
    },
  )

  it('nega IDs inexistentes ou malformados depois de autenticar, sem consultar alvo', async () => {
    const client = sessionClient()
    mocks.requireAuthenticated.mockResolvedValue(context(client))

    await expect(authorizeSerproNfePilotManual({ ...request, consultaId: 'inexistente' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(client.from).not.toHaveBeenCalled()
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
})
