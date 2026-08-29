import { NextRequest, NextResponse } from 'next/server'
import { EnvioRemessaNaoSuportadoError, enviarRemessaOperacional } from '@/lib/remessas/service.server'
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
    const { data: operacao, error: operacaoError } = await context.supabase
      .from('operacoes')
      .select('id')
      .eq('id', operacao_id)
      .maybeSingle()
    if (operacaoError || !operacao) {
      throw new AuthorizationError('Operacao nao encontrada ou sem acesso ao fundo.', 'NOT_FOUND')
    }
    rateLimitIdentifier = `${context.user.id}:${operacao_id}`
    const limited = await verificarRateLimit({ escopo: 'portal_fidc_send', identifier: rateLimitIdentifier, limite: 5 })
    if (!limited.allowed) return NextResponse.json({ error: 'Muitas tentativas de envio. Aguarde antes de tentar novamente.' }, { status: 429 })

    const resultado = await enviarRemessaOperacional(operacao_id)
    await registrarTentativaRateLimit({ escopo: 'portal_fidc_send', identifier: rateLimitIdentifier, sucesso: true })

    return NextResponse.json(resultado)
  } catch (error: unknown) {
    if (rateLimitIdentifier) {
      await registrarTentativaRateLimit({ escopo: 'portal_fidc_send', identifier: rateLimitIdentifier, sucesso: false })
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof EnvioRemessaNaoSuportadoError) {
      return NextResponse.json({ error: error.message, code: 'REMESSA_ENVIO_CONTRATO_PENDENTE' }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[api/contratos/enviar-remessa][ADM]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
