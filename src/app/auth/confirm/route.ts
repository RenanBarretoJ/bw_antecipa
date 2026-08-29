import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { limparFluxoAutenticacao, marcarFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import { normalizarRecoveryNext, recoveryFlowLogShape, sanitizarCodigoErroRecuperacao } from '@/lib/auth/password-recovery'

type ConfirmType = Extract<EmailOtpType, 'recovery' | 'invite'>

function isConfirmType(value: string | null): value is ConfirmType {
  return value === 'recovery' || value === 'invite'
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 })
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  const inviteToken = url.searchParams.get('invite_token')
  const isInvite = type === 'invite'
  const next = isInvite ? '/convite/cedente' : normalizarRecoveryNext(url.searchParams.get('next'))
  const hasCode = url.searchParams.has('code')
  const redirectUrl = new URL(next, url.origin)
  if (isInvite && inviteToken && /^[0-9a-f]{64}$/i.test(inviteToken)) {
    redirectUrl.searchParams.set('token', inviteToken)
  }

  console.info('[auth/confirm]', recoveryFlowLogShape({
    hasTokenHash: !!tokenHash,
    hasCode,
    next,
  }))

  if (!tokenHash || !isConfirmType(type) || (isInvite && !/^[0-9a-f]{64}$/i.test(inviteToken || ''))) {
    await limparFluxoAutenticacao()
    if (isInvite) redirectUrl.searchParams.delete('token')
    redirectUrl.searchParams.set('error_code', isInvite ? 'invite_invalid' : sanitizarCodigoErroRecuperacao(url.searchParams.get('error_code')))
    console.info('[auth/confirm]', recoveryFlowLogShape({
      hasTokenHash: !!tokenHash,
      hasCode,
      success: false,
      errorCode: redirectUrl.searchParams.get('error_code'),
      next,
    }))
    return NextResponse.redirect(redirectUrl)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  })

  if (error) {
    await Promise.allSettled([
      supabase.auth.signOut({ scope: 'local' }),
      limparFluxoAutenticacao(),
    ])
    const errorCode = isInvite ? 'invite_expired' : sanitizarCodigoErroRecuperacao(error.code || url.searchParams.get('error_code'))
    if (isInvite) redirectUrl.searchParams.delete('token')
    redirectUrl.searchParams.set('error_code', errorCode)
    console.info('[auth/confirm]', recoveryFlowLogShape({
      hasTokenHash: true,
      success: false,
      errorCode,
      next,
    }))
    return NextResponse.redirect(redirectUrl)
  }

  if (type === 'recovery') await marcarFluxoAutenticacao('password_recovery')
  else await limparFluxoAutenticacao()
  console.info('[auth/confirm]', recoveryFlowLogShape({
    hasTokenHash: true,
    success: true,
    next,
  }))
  return NextResponse.redirect(redirectUrl)
}
