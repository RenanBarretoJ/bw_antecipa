import { NextRequest, NextResponse } from 'next/server'
import { AuthorizationError, requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { CnabPayloadConflictError, gerarArquivoCnabLegado } from '@/lib/remessas/adapters/cnab444.server'

export const maxDuration = 60

/**
 * Compatibilidade da rota historica. O pipeline real vive no adapter CNAB e
 * tambem e usado pela camada generica /gerar-remessa.
 */
export async function POST(req: NextRequest) {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    const { operacao_id } = await req.json() as { operacao_id?: string }
    if (!operacao_id) return NextResponse.json({ error: 'operacao_id obrigatorio' }, { status: 400 })
    const { data: operacao, error: operacaoError } = await context.supabase.from('operacoes').select('id').eq('id', operacao_id).maybeSingle()
    if (operacaoError || !operacao) throw new AuthorizationError('Operacao nao encontrada ou sem acesso ao fundo.', 'NOT_FOUND')
    const remessa = await gerarArquivoCnabLegado({ operacaoId: operacao_id, userId: context.user.id })
    return new NextResponse(new Uint8Array(remessa.conteudo), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${remessa.nomeArquivo}"`,
        'X-Remessa-Cnab-Id': remessa.remessaCnabId,
        'X-Idempotent-Replay': String(remessa.idempotentReplay),
      },
    })
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof CnabPayloadConflictError) return NextResponse.json({ error: error.message }, { status: 409 })
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[api/contratos/gerar-cnab]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
