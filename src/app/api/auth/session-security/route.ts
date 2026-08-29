import { NextResponse } from 'next/server'
import { limparFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import { MfaSessionError, requireSessaoMfaValida } from '@/lib/auth/mfa'
import { createClient } from '@/lib/supabase/server'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  try {
    const estado = await requireSessaoMfaValida()
    return NextResponse.json({
      valid: true,
      sessionId: estado.sessaoId,
      elevatedAt: estado.sessaoElevadaEm,
      expiresAt: estado.sessaoExpiraEm,
      serverNow: estado.serverNow,
    }, { headers: noStore })
  } catch (error) {
    const expired = error instanceof MfaSessionError && error.mfaCode === 'MFA_SESSION_EXPIRED'
    return NextResponse.json({
      valid: false,
      code: error instanceof MfaSessionError ? error.mfaCode : 'MFA_SESSION_INVALID',
      message: expired ? error.message : 'Sua sessão de segurança não está válida.',
    }, { status: 401, headers: noStore })
  }
}

export async function POST() {
  const supabase = await createClient()
  await Promise.allSettled([
    supabase.rpc('revogar_sessao_mfa_atual', { p_motivo: 'expiracao_24h_cliente' }),
    limparFluxoAutenticacao(),
  ])
  await supabase.auth.signOut({ scope: 'local' })
  return NextResponse.json({ success: true }, { headers: noStore })
}
