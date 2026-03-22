import { NextRequest, NextResponse } from 'next/server'
import { gerarTermoCessao } from '@/lib/pdf/gerarContrato'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    // Verificar role gestor
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || (profile as { role: string }).role !== 'gestor') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { operacao_id } = await req.json()
    if (!operacao_id) return NextResponse.json({ error: 'operacao_id obrigatorio' }, { status: 400 })

    const { url, path } = await gerarTermoCessao(operacao_id)
    return NextResponse.json({ url, path, sucesso: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[api/contratos/gerar-termo]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
