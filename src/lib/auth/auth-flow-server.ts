import { cookies } from 'next/headers'
import { AUTH_FLOW_COOKIE, AUTH_FLOW_MAX_AGE_SECONDS, assinarAuthFlowCookie, lerAuthFlowCookieAssinado, type AuthFlow } from '@/lib/auth/auth-flow'

function cookieOptions(maxAge = AUTH_FLOW_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}

export async function obterFluxoAutenticacao(): Promise<AuthFlow | null> {
  const store = await cookies()
  const value = store.get(AUTH_FLOW_COOKIE)?.value
  return lerAuthFlowCookieAssinado(value)
}

export async function marcarFluxoAutenticacao(flow: AuthFlow) {
  const store = await cookies()
  store.set(AUTH_FLOW_COOKIE, await assinarAuthFlowCookie(flow), cookieOptions())
}

export async function limparFluxoAutenticacao() {
  const store = await cookies()
  store.set(AUTH_FLOW_COOKIE, '', cookieOptions(0))
}
