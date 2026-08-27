import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  classificarErroAuthConviteGestor,
  confirmarTokenConviteGestor,
  gestorInviteLogShape,
  isGestorInviteToken,
  type GestorInviteProfile,
  type GestorInviteState,
} from './gestor-invite'

const page = readFileSync('src/app/convite/gestor/page.tsx', 'utf8')
const passwordForm = readFileSync('src/components/auth/gestor-invite-password-form.tsx', 'utf8')
const confirmRoute = readFileSync('src/app/auth/convite-gestor/confirm/route.ts', 'utf8')
const legacyConfirmRoute = readFileSync('src/app/auth/confirm/route.ts', 'utf8')
const cedentePage = readFileSync('src/app/convite/cedente/page.tsx', 'utf8')
const cedenteInviteServer = readFileSync('src/lib/auth/novo-cedente-invite.server.ts', 'utf8')
const adapter = readFileSync('src/lib/admin/auth-admin.server.ts', 'utf8')
const adminAction = readFileSync('src/app/admin/usuarios/actions.ts', 'utf8')
const lifecycleMigration = readFileSync('supabase/migrations/20260827150511_p0_convite_gestor_lifecycle_aceite.sql', 'utf8')

const token = 'a'.repeat(56)
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'gestor@empresa.com.br' }
const profile: GestorInviteProfile = { ...user, role: 'gestor', status: 'inativo' }
const invitation: GestorInviteState = { id: '22222222-2222-4222-8222-222222222222', status: 'PENDENTE', expires_at: '2026-08-27T16:00:00.000Z' }

function dependencies(overrides: Partial<{
  verifyOtp: () => Promise<{ user: typeof user | null; error: { code?: string; message?: string; status?: number } | null }>
  loadProfile: () => Promise<GestorInviteProfile | null>
  loadInvitation: () => Promise<GestorInviteState | null>
}> = {}) {
  return {
    verifyOtp: overrides.verifyOtp || (async () => ({ user, error: null })),
    loadProfile: overrides.loadProfile || (async () => profile),
    loadInvitation: overrides.loadInvitation || (async () => invitation),
  }
}

describe('P0 - convite de Gestor scanner-safe', () => {
  it('mantem GET idempotente e desloca verifyOtp exclusivamente para POST', () => {
    expect(passwordForm).toContain('method="post"')
    expect(passwordForm).toContain('action="/auth/convite-gestor/confirm"')
    expect(page).not.toContain('verifyOtp')
    expect(confirmRoute).toContain('export async function POST')
    expect(confirmRoute).not.toContain('export async function GET')
    expect(confirmRoute).toContain("verifyOtp({ token_hash: value, type: 'invite' })")
    expect(confirmRoute.indexOf('validarNovaSenha')).toBeLessThan(confirmRoute.indexOf('verifyOtp({ token_hash: value'))
  })

  it('gera o token pelo Supabase sem enviar o link consumidor do Auth', () => {
    expect(adapter).toContain("type: 'invite'")
    expect(adapter).toContain('data.properties.hashed_token')
    expect(adapter).toContain("new URL('/convite/gestor'")
    expect(adapter).toContain('enviarEmailOperacional')
    expect(adapter).not.toContain('inviteUserByEmail')
    expect(isGestorInviteToken('a'.repeat(56))).toBe(true)
    expect(isGestorInviteToken('a'.repeat(64))).toBe(true)
  })

  it('alinha o e-mail e a landing ao padrao visual aprovado do Cedente', () => {
    expect(adapter).toContain('Fundos vinculados:')
    expect(adapter).toContain('expira em 1 hora')
    expect(adapter).toContain('Aceitar convite')
    expect(adapter).toContain("papel = input.accessRole === 'super_admin' ? 'Super Admin' : 'Gestor'")
    expect(adminAction).toContain("rpc('admin_preparar_convite_gestor'")
    expect(page).toContain("'Ativar conta Gestor'")
    expect(page).toContain('Convite de acesso')
    expect(passwordForm).toContain('Aceitar convite e continuar')
    expect(passwordForm).toContain('name="password"')
    expect(passwordForm).toContain('name="confirmPassword"')
  })

  it('persiste o convite pendente sem acesso operacional antes do envio', () => {
    expect(adminAction.indexOf("rpc('admin_preparar_convite_gestor'")).toBeLessThan(adminAction.indexOf('enviarConviteUsuarioAuth({ ...invited, fundos })'))
    expect(adminAction).toContain('p_fundo_ids: parsed.data.fundoIds')
    const prepare = lifecycleMigration.slice(
      lifecycleMigration.indexOf('CREATE OR REPLACE FUNCTION public.admin_preparar_convite_gestor'),
      lifecycleMigration.indexOf('CREATE OR REPLACE FUNCTION public.admin_consultar_convite_gestor'),
    )
    expect(prepare).toContain("status = 'inativo'::public.user_status")
    expect(prepare).toContain('INSERT INTO private.gestor_usuario_convites')
    expect(prepare).not.toContain('INSERT INTO public.usuario_fundos')
  })

  it('confirma usuario, convite pendente e profile inativo no clique humano', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ user, error: null })
    const loadProfile = vi.fn().mockResolvedValue(profile)
    const loadInvitation = vi.fn().mockResolvedValue(invitation)

    await expect(confirmarTokenConviteGestor(token, { verifyOtp, loadProfile, loadInvitation })).resolves.toEqual({ success: true, user, profile })
    expect(verifyOtp).toHaveBeenCalledOnce()
    expect(loadProfile).toHaveBeenCalledWith(user.id)
    expect(loadInvitation).toHaveBeenCalledWith(user.id)
  })

  it('bloqueia replay e preserva a causa Auth sem registrar token', async () => {
    const verifyOtp = vi.fn()
      .mockResolvedValueOnce({ user, error: null })
      .mockResolvedValueOnce({ user: null, error: { code: 'otp_expired', message: 'Token has already been used', status: 403 } })
    const loadProfile = vi.fn().mockResolvedValue(profile)
    const loadInvitation = vi.fn().mockResolvedValue(invitation)

    await expect(confirmarTokenConviteGestor(token, { verifyOtp, loadProfile, loadInvitation })).resolves.toMatchObject({ success: true })
    await expect(confirmarTokenConviteGestor(token, { verifyOtp, loadProfile, loadInvitation })).resolves.toEqual({
      success: false,
      code: 'AUTH_TOKEN_ALREADY_USED',
      authCode: 'otp_expired',
      authStatus: 403,
    })
    expect(gestorInviteLogShape({ success: false, code: 'AUTH_TOKEN_ALREADY_USED', correlationId: 'ref' })).not.toHaveProperty('token')
  })

  it('distingue expiracao, token invalido, cancelamento e e-mail divergente', async () => {
    expect(classificarErroAuthConviteGestor({ code: 'otp_expired', message: 'Token has expired' })).toBe('AUTH_TOKEN_EXPIRED')
    expect(classificarErroAuthConviteGestor({ code: 'bad_json', message: 'Invalid token' })).toBe('AUTH_TOKEN_INVALID')
    expect(isGestorInviteToken(token)).toBe(true)
    expect(isGestorInviteToken('curto')).toBe(false)

    await expect(confirmarTokenConviteGestor(token, dependencies({
      loadInvitation: async () => ({ ...invitation, status: 'CANCELADO' }),
    }))).resolves.toEqual({ success: false, code: 'CONVITE_GESTOR_CANCELADO' })

    await expect(confirmarTokenConviteGestor(token, dependencies({
      loadInvitation: async () => ({ ...invitation, status: 'EXPIRADO' }),
    }))).resolves.toEqual({ success: false, code: 'CONVITE_GESTOR_EXPIRADO' })

    await expect(confirmarTokenConviteGestor(token, dependencies({
      loadProfile: async () => ({ ...profile, email: 'outro@empresa.com.br' }),
    }))).resolves.toEqual({ success: false, code: 'EMAIL_MISMATCH' })

    await expect(confirmarTokenConviteGestor(token, dependencies({
      loadProfile: async () => ({ ...profile, senha_alterada_em: '2026-08-27T10:00:00.000Z' }),
    }))).resolves.toEqual({ success: false, code: 'CONVITE_GESTOR_JA_ACEITO' })
  })

  it('ativa profile, fundos e aceite na mesma transacao logica', () => {
    const accept = lifecycleMigration.slice(lifecycleMigration.indexOf('CREATE OR REPLACE FUNCTION public.aceitar_convite_gestor'))
    expect(accept).toContain("status = 'ativo'::public.user_status")
    expect(accept).toContain('INSERT INTO public.usuario_fundos')
    expect(accept).toContain("SET status = 'ACEITO', aceito_em = now()")
    expect(accept).toContain("'CONVITE_GESTOR_JA_ACEITO'")
  })

  it('preserva os convites antigos e nao altera o fluxo de Cedente', () => {
    expect(legacyConfirmRoute).toContain("const isInvite = type === 'invite'")
    expect(legacyConfirmRoute).toContain("const next = isInvite ? '/convite/cedente'")
    expect(legacyConfirmRoute).toContain('supabase.auth.verifyOtp')
    expect(cedenteInviteServer).toContain("confirmUrl.searchParams.set('invite_token', input.appToken)")
    expect(cedentePage).toContain('Ativar conta Cedente')
    expect(cedentePage).toContain('Aceitar convite e continuar')
    expect(adminAction).toContain("rpc('admin_finalizar_convite_usuario'")
    expect(lifecycleMigration).not.toContain('cedente_usuario_convites')
  })
})
