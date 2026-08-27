import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  classificarErroAuthConviteGestor,
  confirmarTokenConviteGestor,
  gestorInviteLogShape,
  isGestorInviteToken,
} from './gestor-invite'

const page = readFileSync('src/app/convite/gestor/page.tsx', 'utf8')
const passwordForm = readFileSync('src/components/auth/gestor-invite-password-form.tsx', 'utf8')
const confirmRoute = readFileSync('src/app/auth/convite-gestor/confirm/route.ts', 'utf8')
const legacyConfirmRoute = readFileSync('src/app/auth/confirm/route.ts', 'utf8')
const cedentePage = readFileSync('src/app/convite/cedente/page.tsx', 'utf8')
const cedenteInviteServer = readFileSync('src/lib/auth/novo-cedente-invite.server.ts', 'utf8')
const adapter = readFileSync('src/lib/admin/auth-admin.server.ts', 'utf8')
const adminAction = readFileSync('src/app/admin/usuarios/actions.ts', 'utf8')
const migration = readFileSync('supabase/migrations/20260812170000_sa2_admin_usuarios_acessos.sql', 'utf8')

const token = 'a'.repeat(64)
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'gestor@empresa.com.br' }
const profile = { ...user, role: 'gestor', status: 'ativo' }

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
  })

  it('alinha o e-mail e a landing ao padrao visual aprovado do Cedente', () => {
    expect(adapter).toContain('Fundos vinculados:')
    expect(adapter).toContain('expira em 1 hora')
    expect(adapter).toContain('Aceitar convite')
    expect(adapter).toContain("papel = input.accessRole === 'super_admin' ? 'Super Admin' : 'Gestor'")
    expect(adminAction).toContain("rpc('admin_listar_fundos_usuario'")
    expect(page).toContain("'Ativar conta Gestor'")
    expect(page).toContain('Convite de acesso')
    expect(passwordForm).toContain('Aceitar convite e continuar')
    expect(passwordForm).toContain('name="password"')
    expect(passwordForm).toContain('name="confirmPassword"')
  })

  it('provisiona pela RPC SA2 antes do envio e limita os fundos ao payload autorizado', () => {
    expect(adminAction.indexOf("rpc('admin_finalizar_convite_usuario'")).toBeLessThan(adminAction.indexOf('enviarConviteUsuarioAuth({ ...invited, fundos })'))
    expect(adminAction).toContain('p_fundo_ids: parsed.data.fundoIds')
    const finalize = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_finalizar_convite_usuario'))
    expect(finalize).toContain('PERFORM public.admin_vincular_gestor_fundos(p_usuario_id, p_fundo_ids, p_correlation_id)')
    const linkMany = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_vincular_gestor_fundos'))
    expect(linkMany).toContain('v_ids uuid[] := COALESCE(p_fundo_ids, ARRAY[]::uuid[])')
    expect(linkMany).toContain('FOREACH v_fundo_id IN ARRAY v_ids LOOP')
  })

  it('confirma usuario e profile Gestor no clique humano', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ user, error: null })
    const loadProfile = vi.fn().mockResolvedValue(profile)

    await expect(confirmarTokenConviteGestor(token, { verifyOtp, loadProfile })).resolves.toEqual({ success: true, user, profile })
    expect(verifyOtp).toHaveBeenCalledOnce()
    expect(loadProfile).toHaveBeenCalledWith(user.id)
  })

  it('bloqueia replay e preserva a causa Auth sem registrar token', async () => {
    const verifyOtp = vi.fn()
      .mockResolvedValueOnce({ user, error: null })
      .mockResolvedValueOnce({ user: null, error: { code: 'otp_expired', message: 'Token has already been used', status: 403 } })
    const loadProfile = vi.fn().mockResolvedValue(profile)

    await expect(confirmarTokenConviteGestor(token, { verifyOtp, loadProfile })).resolves.toMatchObject({ success: true })
    await expect(confirmarTokenConviteGestor(token, { verifyOtp, loadProfile })).resolves.toEqual({
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

    await expect(confirmarTokenConviteGestor(token, {
      verifyOtp: async () => ({ user, error: null }),
      loadProfile: async () => ({ ...profile, status: 'inativo' }),
    })).resolves.toEqual({ success: false, code: 'CONVITE_GESTOR_CANCELADO' })

    await expect(confirmarTokenConviteGestor(token, {
      verifyOtp: async () => ({ user, error: null }),
      loadProfile: async () => ({ ...profile, email: 'outro@empresa.com.br' }),
    })).resolves.toEqual({ success: false, code: 'EMAIL_MISMATCH' })

    await expect(confirmarTokenConviteGestor(token, {
      verifyOtp: async () => ({ user, error: null }),
      loadProfile: async () => ({ ...profile, senha_alterada_em: '2026-08-27T10:00:00.000Z' }),
    })).resolves.toEqual({ success: false, code: 'CONVITE_GESTOR_JA_ACEITO' })
  })

  it('preserva os convites antigos e nao altera o fluxo de Cedente', () => {
    expect(legacyConfirmRoute).toContain("const isInvite = type === 'invite'")
    expect(legacyConfirmRoute).toContain("const next = isInvite ? '/convite/cedente'")
    expect(legacyConfirmRoute).toContain('supabase.auth.verifyOtp')
    expect(cedenteInviteServer).toContain("confirmUrl.searchParams.set('invite_token', input.appToken)")
    expect(cedentePage).toContain('Ativar conta Cedente')
    expect(cedentePage).toContain('Aceitar convite e continuar')
    expect(adminAction).toContain("rpc('admin_finalizar_convite_usuario'")
  })
})
