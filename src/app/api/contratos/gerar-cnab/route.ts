import { NextRequest, NextResponse } from 'next/server'
import { gerarCnab444 } from '@/lib/cnab/gerarCnab444'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || (profile as { role: string }).role !== 'gestor') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { operacao_id } = await req.json()
    if (!operacao_id) return NextResponse.json({ error: 'operacao_id obrigatorio' }, { status: 400 })

    const cnabContent = await gerarCnab444(operacao_id)
    const nomeArquivo = `REMESSA_${String(operacao_id).slice(0, 8).toUpperCase()}.REM`

    return new NextResponse(cnabContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[api/contratos/gerar-cnab]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
