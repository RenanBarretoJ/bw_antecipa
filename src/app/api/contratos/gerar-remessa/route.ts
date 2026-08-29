import { NextRequest, NextResponse } from 'next/server'
import { AuthorizationError, requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { baixarExcelRemessa, baixarPacoteRemessa, carregarUltimaRemessaDaOperacao, gerarRemessaOperacional } from '@/lib/remessas/service.server'

export const maxDuration = 60

function idsDoBody(body: Record<string, unknown>) {
  const ids = Array.isArray(body.operacao_ids)
    ? body.operacao_ids.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : typeof body.operacao_id === 'string' ? [body.operacao_id] : []
  return [...new Set(ids)]
}

async function validarOperacoesAutorizadas(context: Awaited<ReturnType<typeof requireGestor>>, operacaoIds: string[]) {
  if (operacaoIds.length === 0) throw new Error('operacao_id ou operacao_ids obrigatorio.')
  const { data, error } = await context.supabase.from('operacoes').select('id').in('id', operacaoIds)
  if (error || !data || data.length !== operacaoIds.length) {
    throw new AuthorizationError('Uma ou mais operacoes nao existem ou nao pertencem a um fundo autorizado.', 'FORBIDDEN')
  }
}

export async function POST(req: NextRequest) {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    const body = await req.json() as Record<string, unknown>
    const operacaoIds = idsDoBody(body)
    await validarOperacoesAutorizadas(context, operacaoIds)
    const resultado = await gerarRemessaOperacional({ operacaoIds, userId: context.user.id })
    return NextResponse.json(resultado)
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.message }, { status: error.status })
    const message = error instanceof Error ? error.message : 'Erro desconhecido ao gerar remessa.'
    console.error('[api/contratos/gerar-remessa]', { etapa: 'gerar', erro: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    const operacaoId = req.nextUrl.searchParams.get('operacao_id')
    if (operacaoId) {
      await validarOperacoesAutorizadas(context, [operacaoId])
      return NextResponse.json(await carregarUltimaRemessaDaOperacao(operacaoId))
    }
    const remessaId = req.nextUrl.searchParams.get('remessa_id')
    const tipo = req.nextUrl.searchParams.get('tipo')
    if (!remessaId || !['excel', 'pacote'].includes(tipo ?? '')) return NextResponse.json({ error: 'remessa_id e tipo valido sao obrigatorios.' }, { status: 400 })
    const { data: autorizada, error: autorizacaoError } = await context.supabase
      .from('remessas_operacionais')
      .select('id')
      .eq('id', remessaId)
      .maybeSingle()
    if (autorizacaoError || !autorizada) throw new AuthorizationError('Remessa nao encontrada ou sem acesso ao fundo.', 'NOT_FOUND')
    const arquivo = tipo === 'excel' ? await baixarExcelRemessa(remessaId) : await baixarPacoteRemessa(remessaId)
    return new NextResponse(new Uint8Array(arquivo.conteudo), {
      status: 200,
      headers: {
        'Content-Type': tipo === 'excel'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/zip',
        'Content-Disposition': `attachment; filename="${arquivo.nomeArquivo}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.message }, { status: error.status })
    const message = error instanceof Error ? error.message : 'Erro desconhecido ao baixar remessa.'
    console.error('[api/contratos/gerar-remessa]', { etapa: 'download', erro: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
