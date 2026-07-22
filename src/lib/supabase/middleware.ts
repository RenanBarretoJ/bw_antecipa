import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
  const publicRoutes = ['/', '/login', '/cadastro']
  const isPublicRoute = publicRoutes.some((route) => pathname === route)
  const authRoutes = ['/login', '/cadastro']
  const isAuthRoute = authRoutes.some((route) => pathname === route)
  const isMfaRoute = pathname.startsWith('/mfa')

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isAuthRoute) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, mfa_obrigatorio_override')
      .eq('id', user.id)
      .single()

    const role = String(profile?.role || 'cedente')
    const mfaRedirect = await getMfaRedirect({
      supabase,
      userId: user.id,
      role,
      override: (profile as { mfa_obrigatorio_override?: boolean | null } | null)?.mfa_obrigatorio_override,
      pathname,
    })

    const url = request.nextUrl.clone()
    url.pathname = mfaRedirect || getDashboardByRole(role)
    return NextResponse.redirect(url)
  }

  if (user && !isMfaRoute) {
    const roleFromPath = getRoleFromPath(pathname)

    if (roleFromPath) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, mfa_obrigatorio_override')
        .eq('id', user.id)
        .single()

      const userRole = String(profile?.role || 'cedente')

      if (roleFromPath !== userRole) {
        const url = request.nextUrl.clone()
        url.pathname = getDashboardByRole(userRole)
        return NextResponse.redirect(url)
      }

      const mfaRedirect = await getMfaRedirect({
        supabase,
        userId: user.id,
        role: userRole,
        override: (profile as { mfa_obrigatorio_override?: boolean | null } | null)?.mfa_obrigatorio_override,
        pathname,
      })

      if (mfaRedirect) {
        const url = request.nextUrl.clone()
        url.pathname = mfaRedirect
        return NextResponse.redirect(url)
      }
    }
  }

  return supabaseResponse
}

function getDashboardByRole(role: string): string {
  const dashboards: Record<string, string> = {
    gestor: '/gestor/dashboard',
    cedente: '/cedente/dashboard',
    sacado: '/sacado/dashboard',
    consultor: '/consultor/dashboard',
  }
  return dashboards[role] || '/cedente/dashboard'
}

function getRoleFromPath(pathname: string): string | null {
  const roles = ['gestor', 'cedente', 'sacado', 'consultor']
  for (const role of roles) {
    if (pathname.startsWith(`/${role}`)) return role
  }
  return null
}

async function getMfaRedirect({
  supabase,
  userId,
  role,
  override,
  pathname,
}: {
  supabase: MiddlewareSupabaseClient
  userId: string
  role: string
  override?: boolean | null
  pathname: string
}) {
  if (pathname.startsWith('/mfa')) return null

  let exigeMfa = override ?? (role === 'gestor' || role === 'consultor')

  if (!exigeMfa && role === 'cedente') {
    const [{ data: cedenteProprio }, { data: acessoAdmin }] = await Promise.all([
      supabase.from('cedentes').select('id').eq('user_id', userId).maybeSingle(),
      supabase.from('cedente_acessos').select('id').eq('user_id', userId).eq('ativo', true).eq('perfil', 'administrador').maybeSingle(),
    ])
    exigeMfa = !!cedenteProprio || !!acessoAdmin
  }

  const { data: factors } = await supabase.auth.mfa.listFactors()
  const possuiFator = (factors?.totp || []).some((factor: unknown) => {
    const value = factor as { status?: string }
    return value.status === 'verified'
  })

  if (exigeMfa && !possuiFator) return '/mfa/setup'

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const aalAtual = aal?.currentLevel === 'aal2' ? 'aal2' : 'aal1'

  if ((exigeMfa || possuiFator) && aalAtual !== 'aal2') return '/mfa/desafio'

  if (exigeMfa) {
    const { data: sessao } = await supabase
      .from('sessoes_elevadas')
      .select('expira_em')
      .eq('user_id', userId)
      .gt('expira_em', new Date().toISOString())
      .maybeSingle()

    if (!sessao) return '/mfa/desafio'
  }

  return null
}
