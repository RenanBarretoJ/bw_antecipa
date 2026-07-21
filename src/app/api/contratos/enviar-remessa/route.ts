import { NextRequest, NextResponse } from 'next/server'
import { enviarRemessaFromtis } from '@/lib/fromtis/remessa'
import { AuthorizationError, requireGestor } from '@/lib/auth/authorization'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    await requireGestor()

    const { operacao_id } = await req.json()
    if (!operacao_id) return NextResponse.json({ error: 'operacao_id obrigatorio' }, { status: 400 })

    const resultado = await enviarRemessaFromtis(operacao_id)

    return NextResponse.json(resultado)
  } catch (error: unknown) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[api/contratos/enviar-remessa]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
