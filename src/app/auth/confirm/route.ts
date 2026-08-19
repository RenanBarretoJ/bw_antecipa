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
  const next = normalizarRecoveryNext(url.searchParams.get('next'))
  const hasCode = url.searchParams.has('code')
  const redirectUrl = new URL(next, url.origin)

  console.info('[auth/confirm]', recoveryFlowLogShape({
    hasTokenHash: !!tokenHash,
    hasCode,
    next,
  }))

  if (!tokenHash || !isConfirmType(type)) {
    await limparFluxoAutenticacao()
    redirectUrl.searchParams.set('error_code', sanitizarCodigoErroRecuperacao(url.searchParams.get('error_code')))
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
    const errorCode = sanitizarCodigoErroRecuperacao(error.code || url.searchParams.get('error_code'))
    redirectUrl.searchParams.set('error_code', errorCode)
    console.info('[auth/confirm]', recoveryFlowLogShape({
      hasTokenHash: true,
      success: false,
      errorCode,
      next,
    }))
    return NextResponse.redirect(redirectUrl)
  }

  await marcarFluxoAutenticacao('password_recovery')
  console.info('[auth/confirm]', recoveryFlowLogShape({
    hasTokenHash: true,
    success: true,
    next,
  }))
  return NextResponse.redirect(redirectUrl)
}
