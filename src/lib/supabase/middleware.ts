import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Rotas públicas
  const publicRoutes = ['/login', '/cadastro']
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))

  // Se não autenticado e rota protegida → redireciona para login
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Se autenticado e em rota pública → redireciona para dashboard
  if (user && isPublicRoute) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role || 'cedente'
    const url = request.nextUrl.clone()
    url.pathname = getDashboardByRole(role)
    return NextResponse.redirect(url)
  }

  // Se autenticado, verificar se está no portal correto
  if (user) {
    const roleFromPath = getRoleFromPath(pathname)

    if (roleFromPath) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      const userRole = profile?.role || 'cedente'

      if (roleFromPath !== userRole) {
        const url = request.nextUrl.clone()
        url.pathname = getDashboardByRole(userRole)
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
    if (pathname.startsWith(`/${role}`)) {
      return role
    }
  }
  return null
}
