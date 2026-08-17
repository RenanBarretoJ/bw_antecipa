import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_FLOW_COOKIE, getAuthFlowRedirect, isMfaSetupAllowedPath, isPasswordRecoveryAllowedPath, lerAuthFlowCookieAssinado } from '@/lib/auth/auth-flow'
import { resolverRedirectOnboardingCedente } from '@/lib/auth/cedente-onboarding-access'
import { carregarAcessoPlataforma, resolverDestinoAposAutenticacao, usuarioPodeAcessarArea, type PortalArea } from '@/lib/auth/platform-access'
import type { UserRole } from '@/types/database'
import { IdentityQueryError, loadSessionProfile } from '@/lib/auth/identity-query'

type MiddlewareSupabaseClient = ReturnType<typeof createServerClient>

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname
  const authFlowCookie = request.cookies.get(AUTH_FLOW_COOKIE)?.value
  const authFlow = await lerAuthFlowCookieAssinado(authFlowCookie)
  const publicRoutes = ['/', '/login', '/cadastro', '/esqueci-senha', '/redefinir-senha', '/auth/confirm']
  const isPublicRoute = publicRoutes.some((route) => pathname === route)
  const authRoutes = ['/login', '/cadastro', '/esqueci-senha']
  const isAuthRoute = authRoutes.some((route) => pathname === route)
  const isMfaRoute = pathname.startsWith('/mfa')
  const isPasswordRecoveryRoute = pathname === '/redefinir-senha'
  const isServerActionRequest = request.method === 'POST' && request.headers.has('next-action')

  // Server Actions usam um protocolo próprio de resposta do Next.js. Se o proxy
  // responder com redirect HTML para login/MFA, o client recebe uma resposta
  // inválida e lança "An unexpected response was received from the server".
  // Autorização e MFA continuam sendo validados nas actions server-side.
  if (isServerActionRequest) return supabaseResponse

  if (authFlow) {
    const allowed = authFlow === 'password_recovery'
      ? isPasswordRecoveryAllowedPath(pathname)
      : isMfaSetupAllowedPath(pathname)

    if (!user && pathname !== '/redefinir-senha' && pathname !== '/esqueci-senha' && pathname !== '/login') {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      const response = NextResponse.redirect(url)
      response.cookies.set(AUTH_FLOW_COOKIE, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      })
      return response
    }

    if (user && !allowed) {
      const url = request.nextUrl.clone()
      url.pathname = getAuthFlowRedirect(authFlow)
      return NextResponse.redirect(url)
    }
  }

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isAuthRoute) {
    if (authFlow) {
      const url = request.nextUrl.clone()
      url.pathname = getAuthFlowRedirect(authFlow)
      return NextResponse.redirect(url)
    }

    const profile = await loadMiddlewareProfile(supabase, user.id)
    if (!profile) return await redirectInvalidIdentity(request, supabase)

    const role = String(profile.role) as UserRole
    const mfaRedirect = await getMfaRedirect({
      supabase,
      role,
      override: profile.mfa_obrigatorio_override,
      pathname,
    })

    const access = await carregarAcessoPlataforma(supabase, user.id, role)
    const url = request.nextUrl.clone()
    url.pathname = mfaRedirect || resolverDestinoAposAutenticacao(access)
    return NextResponse.redirect(url)
  }

  if (user && !isMfaRoute && !isPasswordRecoveryRoute) {
    const roleFromPath = getRoleFromPath(pathname)

    if (roleFromPath) {
      const profile = await loadMiddlewareProfile(supabase, user.id)
      if (!profile) return await redirectInvalidIdentity(request, supabase)

      const userRole = String(profile.role) as UserRole
      const access = await carregarAcessoPlataforma(supabase, user.id, userRole)

      const areaAutorizada = usuarioPodeAcessarArea(access, roleFromPath)

      if (!areaAutorizada) {
        const url = request.nextUrl.clone()
        url.pathname = resolverDestinoAposAutenticacao(access)
        return NextResponse.redirect(url)
      }

      const mfaRedirect = await getMfaRedirect({
        supabase,
        role: userRole,
        override: profile.mfa_obrigatorio_override,
        pathname,
      })

      if (mfaRedirect) {
        const url = request.nextUrl.clone()
        url.pathname = mfaRedirect
        return NextResponse.redirect(url)
      }

      if (roleFromPath === 'gestor') {
        if (!access.gestorPossuiFundoAtivo && pathname !== '/gestor/sem-fundo') {
          const url = request.nextUrl.clone()
          url.pathname = '/gestor/sem-fundo'
          return NextResponse.redirect(url)
        }
        if (access.gestorPossuiFundoAtivo && pathname === '/gestor/sem-fundo') {
          const url = request.nextUrl.clone()
          url.pathname = '/gestor/dashboard'
          return NextResponse.redirect(url)
        }
      }

      if (userRole === 'cedente') {
        const { data: cedente } = await supabase
          .from('cedentes')
          .select('status')
          .eq('user_id', user.id)
          .maybeSingle()
        const onboardingRedirect = resolverRedirectOnboardingCedente({
          pathname,
          status: cedente?.status,
        })

        if (onboardingRedirect) {
          const url = request.nextUrl.clone()
          url.pathname = onboardingRedirect
          return NextResponse.redirect(url)
        }
      }
    }
  }

  return supabaseResponse
}

async function loadMiddlewareProfile(supabase: MiddlewareSupabaseClient, userId: string) {
  try {
    return await loadSessionProfile(supabase, userId)
  } catch (error) {
    if (error instanceof IdentityQueryError) return null
    throw error
  }
}

async function redirectInvalidIdentity(request: NextRequest, supabase: MiddlewareSupabaseClient) {
  await supabase.auth.signOut({ scope: 'local' })
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('error', 'identity_validation_failed')
  return NextResponse.redirect(url)
}

function getRoleFromPath(pathname: string): PortalArea | null {
  const roles: PortalArea[] = ['gestor', 'cedente', 'sacado', 'consultor', 'admin']
  for (const role of roles) {
    if (pathname.startsWith(`/${role}`)) return role
  }
  return null
}

async function getMfaRedirect({
  supabase,
  role,
  override,
  pathname,
}: {
  supabase: MiddlewareSupabaseClient
  role: string
  override?: boolean | null
  pathname: string
}) {
  if (pathname.startsWith('/mfa')) return null

  const exigeMfa = override === true || ['gestor', 'cedente', 'sacado', 'consultor', 'super_admin'].includes(role)

  const { data: factors } = await supabase.auth.mfa.listFactors()
  const possuiFator = (factors?.totp || []).some((factor: unknown) => {
    const value = factor as { status?: string }
    return value.status === 'verified'
  })

  if (exigeMfa && !possuiFator) return '/mfa/setup'

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const aalAtual = aal?.currentLevel === 'aal2' ? 'aal2' : 'aal1'

  const { data: sessaoData, error: sessaoError } = await supabase.rpc('obter_sessao_mfa_atual')
  const sessao = (Array.isArray(sessaoData) ? sessaoData[0] : sessaoData) as { status?: string; metodo?: string } | null
  const segundoFatorValido = !sessaoError && aalAtual === 'aal2' && sessao?.status === 'valid' && sessao.metodo === 'totp'

  if (['expired', 'revoked', 'session_invalid'].includes(sessao?.status || '')) {
    await supabase.rpc('revogar_sessao_mfa_atual', { p_motivo: sessao?.status || 'sessao_invalida' })
    await supabase.auth.signOut({ scope: 'local' })
    return '/login'
  }

  if ((exigeMfa || possuiFator) && !segundoFatorValido) return '/mfa/desafio'

  return null
}
