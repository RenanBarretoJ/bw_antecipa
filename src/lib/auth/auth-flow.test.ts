import { describe, expect, it } from 'vitest'
import { assinarAuthFlowCookie, getAuthFlowRedirect, isAuthFlow, isGestorInviteAllowedPath, isMfaSetupAllowedPath, isPasswordRecoveryAllowedPath, lerAuthFlowCookieAssinado } from './auth-flow'

describe('auth flow routing rules', () => {
  it('accepts only signed auth flow cookies as operational flow markers', async () => {
    process.env.AUTH_FLOW_COOKIE_SECRET = 'test-secret-with-enough-entropy'
    const signed = await assinarAuthFlowCookie('password_recovery')

    await expect(lerAuthFlowCookieAssinado(signed)).resolves.toBe('password_recovery')
    await expect(lerAuthFlowCookieAssinado('password_recovery')).resolves.toBeNull()
    await expect(lerAuthFlowCookieAssinado(signed.replace('password_recovery', 'mfa_setup_required'))).resolves.toBeNull()
  })

  it('recognizes only supported restricted auth flows', () => {
    expect(isAuthFlow('password_recovery')).toBe(true)
    expect(isAuthFlow('gestor_invite')).toBe(true)
    expect(isAuthFlow('mfa_setup_required')).toBe(true)
    expect(isAuthFlow('mfa_recovery_temporary')).toBe(true)
    expect(isAuthFlow('normal')).toBe(false)
  })

  it('allows only reset and MFA routes during password recovery', () => {
    expect(isPasswordRecoveryAllowedPath('/redefinir-senha')).toBe(true)
    expect(isPasswordRecoveryAllowedPath('/mfa/desafio')).toBe(true)
    expect(isPasswordRecoveryAllowedPath('/gestor/dashboard')).toBe(false)
    expect(isPasswordRecoveryAllowedPath('/cedente/notas-fiscais')).toBe(false)
  })

  it('keeps MFA setup flows away from operational routes', () => {
    expect(isMfaSetupAllowedPath('/mfa/setup')).toBe(true)
    expect(isMfaSetupAllowedPath('/mfa/desafio')).toBe(true)
    expect(isMfaSetupAllowedPath('/gestor/dashboard')).toBe(false)
  })

  it('restringe a sessao temporaria do convite de Gestor ao aceite e MFA', () => {
    expect(isGestorInviteAllowedPath('/convite/gestor')).toBe(true)
    expect(isGestorInviteAllowedPath('/mfa/setup')).toBe(true)
    expect(isGestorInviteAllowedPath('/gestor/dashboard')).toBe(false)
    expect(isGestorInviteAllowedPath('/admin/usuarios')).toBe(false)
  })

  it('redirects restricted flows to their safe destination', () => {
    expect(getAuthFlowRedirect('password_recovery')).toBe('/redefinir-senha')
    expect(getAuthFlowRedirect('gestor_invite')).toBe('/convite/gestor')
    expect(getAuthFlowRedirect('mfa_setup_required')).toBe('/mfa/setup')
    expect(getAuthFlowRedirect('mfa_recovery_temporary')).toBe('/mfa/setup')
  })
})
