import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Gera signed URL para download de PDF do bucket privado 'contratos'
// GET /api/contratos/download?path=cedentes/xxx/contrato-cessao.pdf
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    const filePath = req.nextUrl.searchParams.get('path')
    if (!filePath) return NextResponse.json({ error: 'path obrigatorio' }, { status: 400 })

    // Usar service role para acessar bucket privado
    const { createClient: createAdmin } = await import('@supabase/supabase-js')
    const supabaseAdmin = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data, error } = await supabaseAdmin.storage
      .from('contratos')
      .createSignedUrl(filePath, 3600) // 1 hora

    if (error) {
      return NextResponse.json({ error: `Erro ao gerar URL: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({ url: data.signedUrl })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error('[api/contratos/download]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
