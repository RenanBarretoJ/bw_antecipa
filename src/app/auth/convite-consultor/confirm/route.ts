import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { limparFluxoAutenticacao, marcarFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import { confirmarTokenConviteConsultor, type ConsultorInviteErrorCode, type ConsultorInviteState } from '@/lib/auth/consultor-invite'
import { finalizarConviteConsultorAutenticado } from '@/lib/auth/consultor-invite-completion.server'
import { registrarEventoSeguranca } from '@/lib/auth/mfa'
import { validarNovaSenha } from '@/lib/auth/password'
import { createClient } from '@/lib/supabase/server'

function redirect(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/convite/consultor', request.url)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  return NextResponse.redirect(url, 303)
}

function origemValida(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

async function registrarFalha(code: ConsultorInviteErrorCode, correlationId: string) {
  await registrarEventoSeguranca({ tipo_evento: 'ACESSO_NEGADO', ator_tipo: 'sistema', origem: 'convite_consultor', severidade: 'warning', correlation_id: correlationId, dados: { causa: code } }).catch(() => undefined)
}

export async function POST(request: NextRequest) {
  const correlationId = randomUUID()
  if (!origemValida(request)) { await registrarFalha('AUTH_TOKEN_INVALID', correlationId); return redirect(request, { error_code: 'AUTH_TOKEN_INVALID' }) }
  let tokenHash = ''; let type = ''; let password = ''; let confirmPassword = ''
  try {
    const formData = await request.formData()
    tokenHash = String(formData.get('token_hash') || '')
    type = String(formData.get('type') || '')
    password = String(formData.get('password') || '')
    confirmPassword = String(formData.get('confirmPassword') || '')
  } catch { return redirect(request, { error_code: 'AUTH_TOKEN_INVALID' }) }
  if (type !== 'invite') return redirect(request, { error_code: 'AUTH_TOKEN_INVALID' })
  if (!validarNovaSenha({ password, confirmPassword }).valid) return redirect(request, { token_hash: tokenHash, type: 'invite', password_error: 'invalid' })

  const supabase = await createClient()
  const result = await confirmarTokenConviteConsultor(tokenHash, {
    verifyOtp: async (value) => {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: value, type: 'invite' })
      return { user: data.user ? { id: data.user.id, email: data.user.email || null } : null, error: error ? { code: error.code, message: error.message, status: error.status } : null }
    },
    loadProfile: async (userId) => {
      const { data, error } = await supabase.from('profiles').select('id, email, role, status, senha_alterada_em').eq('id', userId).maybeSingle()
      return error ? null : data
    },
    loadInvitation: async () => {
      const { data, error } = await supabase.rpc('consultar_convite_consultor_atual')
      return error ? null : data as unknown as ConsultorInviteState | null
    },
  })
  if (!result.success) {
    await Promise.allSettled([supabase.auth.signOut({ scope: 'local' }), limparFluxoAutenticacao()])
    await registrarFalha(result.code, correlationId)
    return redirect(request, { error_code: result.code })
  }
  await marcarFluxoAutenticacao('consultor_invite')
  const completion = await finalizarConviteConsultorAutenticado({ supabase, userId: result.user.id, password, correlationId })
  if (!completion.success) return redirect(request, { completion_error: 'true' })
  return NextResponse.redirect(new URL(completion.redirectTo, request.url), 303)
}
