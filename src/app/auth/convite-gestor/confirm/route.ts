import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { limparFluxoAutenticacao, marcarFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import {
  confirmarTokenConviteGestor,
  gestorInviteLogShape,
  type GestorInviteErrorCode,
} from '@/lib/auth/gestor-invite'
import { finalizarConviteGestorAutenticado, type GestorInviteRole } from '@/lib/auth/gestor-invite-completion.server'
import { registrarEventoSeguranca } from '@/lib/auth/mfa'
import { validarNovaSenha } from '@/lib/auth/password'
import { createClient } from '@/lib/supabase/server'

function redirectErro(request: NextRequest, code: GestorInviteErrorCode) {
  const url = new URL('/convite/gestor', request.url)
  url.searchParams.set('error_code', code)
  return NextResponse.redirect(url, 303)
}

function redirectSenhaInvalida(request: NextRequest, tokenHash: string, role: GestorInviteRole) {
  const url = new URL('/convite/gestor', request.url)
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', 'invite')
  url.searchParams.set('role', role)
  url.searchParams.set('password_error', 'invalid')
  return NextResponse.redirect(url, 303)
}

function redirectConclusaoIncompleta(request: NextRequest) {
  const url = new URL('/convite/gestor', request.url)
  url.searchParams.set('completion_error', 'true')
  return NextResponse.redirect(url, 303)
}

function origemValida(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

async function registrarFalha(input: {
  code: GestorInviteErrorCode
  authCode?: string
  authStatus?: number
  correlationId: string
  userId?: string
}) {
  console.info('[convite-gestor][confirm]', gestorInviteLogShape({ success: false, ...input }))
  await registrarEventoSeguranca({
    tipo_evento: 'ACESSO_NEGADO',
    usuario_id: input.userId || null,
    ator_usuario_id: input.userId || null,
    ator_tipo: input.userId ? 'usuario' : 'sistema',
    origem: 'convite_gestor',
    severidade: 'warning',
    correlation_id: input.correlationId,
    dados: {
      causa: input.code,
      auth_code: input.authCode || null,
      auth_status: input.authStatus || null,
    },
  }).catch(() => undefined)
}

export async function POST(request: NextRequest) {
  const correlationId = randomUUID()
  if (!origemValida(request)) {
    await registrarFalha({ code: 'AUTH_TOKEN_INVALID', correlationId })
    return redirectErro(request, 'AUTH_TOKEN_INVALID')
  }

  let tokenHash = ''
  let type = ''
  let password = ''
  let confirmPassword = ''
  let requestedRole: GestorInviteRole = 'gestor'
  try {
    const formData = await request.formData()
    tokenHash = String(formData.get('token_hash') || '')
    type = String(formData.get('type') || '')
    password = String(formData.get('password') || '')
    confirmPassword = String(formData.get('confirmPassword') || '')
    requestedRole = formData.get('role') === 'super_admin' ? 'super_admin' : 'gestor'
  } catch {
    await registrarFalha({ code: 'AUTH_TOKEN_INVALID', correlationId })
    return redirectErro(request, 'AUTH_TOKEN_INVALID')
  }

  if (type !== 'invite') {
    await registrarFalha({ code: 'AUTH_TOKEN_INVALID', correlationId })
    return redirectErro(request, 'AUTH_TOKEN_INVALID')
  }

  const passwordValidation = validarNovaSenha({ password, confirmPassword })
  if (!passwordValidation.valid) {
    return redirectSenhaInvalida(request, tokenHash, requestedRole)
  }

  const supabase = await createClient()
  const result = await confirmarTokenConviteGestor(tokenHash, {
    verifyOtp: async (value) => {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: value, type: 'invite' })
      return {
        user: data.user ? { id: data.user.id, email: data.user.email || null } : null,
        error: error ? { code: error.code, message: error.message, status: error.status } : null,
      }
    },
    loadProfile: async (userId) => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, role, status, senha_alterada_em')
        .eq('id', userId)
        .maybeSingle()
      if (error || !data) return null
      return data
    },
  })

  if (!result.success) {
    await Promise.allSettled([
      supabase.auth.signOut({ scope: 'local' }),
      limparFluxoAutenticacao(),
    ])
    await registrarFalha({
      code: result.code,
      authCode: result.authCode,
      authStatus: result.authStatus,
      correlationId,
    })
    return redirectErro(request, result.code)
  }

  await marcarFluxoAutenticacao('gestor_invite')
  console.info('[convite-gestor][confirm]', gestorInviteLogShape({
    success: true,
    correlationId,
    userId: result.user.id,
  }))

  const completion = await finalizarConviteGestorAutenticado({
    supabase,
    userId: result.user.id,
    role: result.profile.role as GestorInviteRole,
    password,
  })
  if (!completion.success) {
    console.info('[convite-gestor][completion]', {
      fluxo: 'convite_gestor',
      success: false,
      code: completion.code,
      correlation_id: correlationId,
      user_id: result.user.id,
    })
    return redirectConclusaoIncompleta(request)
  }

  return NextResponse.redirect(new URL(completion.redirectTo, request.url), 303)
}
