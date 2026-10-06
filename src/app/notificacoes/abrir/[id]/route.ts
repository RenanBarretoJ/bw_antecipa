import { NextRequest, NextResponse } from 'next/server'
import { resolverDestinoNotificacao } from '@/lib/notificacoes/destino.server'
import type { NotificacaoEscopo } from '@/lib/notificacoes/contracts'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const fundoId = request.nextUrl.searchParams.get('fundo')
    const geral = request.nextUrl.searchParams.get('scope') === 'GLOBAL'
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuid.test(id) || (geral ? fundoId !== null : !fundoId || !uuid.test(fundoId))) throw new Error('Contexto inválido.')
    const escopo: NotificacaoEscopo = geral ? { scope: 'GLOBAL', fundoId: null } : { scope: 'FUNDO', fundoId: fundoId! }
    const destino = await resolverDestinoNotificacao(id, escopo)
    const response = NextResponse.redirect(new URL(destino, request.url), 303)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch {
    return NextResponse.json({ error: 'Acesso negado. Volte às notificações e confira o Fundo ativo.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
