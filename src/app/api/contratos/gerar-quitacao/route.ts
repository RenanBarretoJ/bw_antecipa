import { NextRequest, NextResponse } from 'next/server'
import { gerarTermoQuitacao } from '@/lib/pdf/gerarContrato'
import { AuthorizationError, requireGestor } from '@/lib/auth/authorization'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const context = await requireGestor()

    const { operacao_id } = await req.json()
    if (!operacao_id) return NextResponse.json({ error: 'operacao_id obrigatorio' }, { status: 400 })

    const { url, path } = await gerarTermoQuitacao(operacao_id, context.user.id)
    return NextResponse.json({ url, path, sucesso: true })
  } catch (error: unknown) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[api/contratos/gerar-quitacao]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
