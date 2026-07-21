import { NextRequest, NextResponse } from 'next/server'
import { gerarCnab444 } from '@/lib/cnab/gerarCnab444'
import { AuthorizationError, requireGestor } from '@/lib/auth/authorization'
import { createAdminClient } from '@/lib/supabase/server'
import { buckets } from '@/lib/storage'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    await requireGestor()

    const { operacao_id } = await req.json()
    if (!operacao_id) return NextResponse.json({ error: 'operacao_id obrigatorio' }, { status: 400 })

    const cnabContent = await gerarCnab444(operacao_id)
    const nomeArquivo = `REMESSA_${String(operacao_id).slice(0, 8).toUpperCase()}.REM`

    // Salvar no storage como lastro — falha silenciosa para não bloquear o download
    try {
      const caminho = `operacoes/${operacao_id}/remessa.REM`
      const admin = createAdminClient()
      await admin.storage.from(buckets.contratos).upload(
        caminho,
        Buffer.from(cnabContent, 'utf-8'),
        { contentType: 'text/plain; charset=utf-8', upsert: true }
      )
      await admin.from('operacoes').update({
        remessa_url: caminho,
        remessa_gerado_em: new Date().toISOString(),
      } as never).eq('id', operacao_id)
    } catch (storageErr) {
      console.error('[api/contratos/gerar-cnab] storage:', storageErr)
    }

    return new NextResponse(cnabContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
      },
    })
  } catch (error: unknown) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[api/contratos/gerar-cnab]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
