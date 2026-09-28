import { describe, expect, it, vi } from 'vitest'
import { confirmarTokenConviteConsultor, isConsultorInviteToken, mensagemConviteConsultor } from './consultor-invite'

const token = 'a'.repeat(56)
const user = { id: '10000000-0000-4000-8000-000000000001', email: 'owner@example.invalid' }
const profile = { id: user.id, email: user.email, role: 'consultor', status: 'inativo', senha_alterada_em: null }
const invitation = { consultor_id: '20000000-0000-4000-8000-000000000001', consultor_nome: 'XPTO', papel: 'OWNER' as const, status: 'PENDENTE' as const, expires_at: new Date(Date.now() + 60_000).toISOString() }

function deps(overrides: Partial<Parameters<typeof confirmarTokenConviteConsultor>[1]> = {}) {
  return {
    verifyOtp: vi.fn(async () => ({ user, error: null })),
    loadProfile: vi.fn(async () => profile),
    loadInvitation: vi.fn(async () => invitation),
    ...overrides,
  }
}

describe('convite de usuario da Consultoria', () => {
  it('aceita apenas token scanner-safe suportado', () => {
    expect(isConsultorInviteToken(token)).toBe(true)
    expect(isConsultorInviteToken('x'.repeat(56))).toBe(false)
    expect(isConsultorInviteToken('')).toBe(false)
  })

  it('confirma somente perfil Consultor inativo e membership pendente', async () => {
    await expect(confirmarTokenConviteConsultor(token, deps())).resolves.toMatchObject({ success: true, invitation })
    await expect(confirmarTokenConviteConsultor(token, deps({ loadProfile: vi.fn(async () => ({ ...profile, role: 'gestor' })) }))).resolves.toMatchObject({ success: false, code: 'PROFILE_INVALID' })
    await expect(confirmarTokenConviteConsultor(token, deps({ loadInvitation: vi.fn(async () => ({ ...invitation, status: 'CANCELADO' as const })) }))).resolves.toMatchObject({ success: false, code: 'CONVITE_CONSULTOR_CANCELADO' })
  })

  it('bloqueia e-mail divergente e convite ja usado', async () => {
    await expect(confirmarTokenConviteConsultor(token, deps({ loadProfile: vi.fn(async () => ({ ...profile, email: 'outro@example.invalid' })) }))).resolves.toMatchObject({ success: false, code: 'EMAIL_MISMATCH' })
    await expect(confirmarTokenConviteConsultor(token, deps({ loadProfile: vi.fn(async () => ({ ...profile, senha_alterada_em: new Date().toISOString() })) }))).resolves.toMatchObject({ success: false, code: 'CONVITE_CONSULTOR_JA_ACEITO' })
  })

  it('mantem mensagens operacionais sem expor detalhes do Auth', () => {
    expect(mensagemConviteConsultor('AUTH_TOKEN_EXPIRED')).toContain('expirou')
    expect(mensagemConviteConsultor('PROFILE_INVALID')).toContain('administrador')
  })
})
