import { NextRequest, NextResponse } from 'next/server'
import { enviarRemessaPortalFidc } from '@/lib/portal-fidc/integracao'
import { AuthorizationError, requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { registrarTentativaRateLimit, verificarRateLimit } from '@/lib/security/rate-limit'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  let rateLimitIdentifier: string | null = null
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)

    const { operacao_id } = await req.json()
    if (!operacao_id) return NextResponse.json({ error: 'operacao_id obrigatorio' }, { status: 400 })
    rateLimitIdentifier = `${context.user.id}:${operacao_id}`
    const limited = await verificarRateLimit({ escopo: 'portal_fidc_send', identifier: rateLimitIdentifier, limite: 5 })
    if (!limited.allowed) return NextResponse.json({ error: 'Muitas tentativas de envio. Aguarde antes de tentar novamente.' }, { status: 429 })

    const resultado = await enviarRemessaPortalFidc(operacao_id)
    await registrarTentativaRateLimit({ escopo: 'portal_fidc_send', identifier: rateLimitIdentifier, sucesso: true })

    return NextResponse.json(resultado)
  } catch (error: unknown) {
    if (rateLimitIdentifier) {
      await registrarTentativaRateLimit({ escopo: 'portal_fidc_send', identifier: rateLimitIdentifier, sucesso: false })
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[api/contratos/enviar-remessa][Portal FIDC]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
