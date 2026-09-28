import { createPdfTelemetry, PDF_PUBLIC_ERROR } from '@/lib/pdf/pdf-telemetry'
import { NextRequest, NextResponse } from 'next/server'
import { gerarTermoCessao } from '@/lib/pdf/gerarContrato'
import { AuthorizationError, requireGestor } from '@/lib/auth/authorization'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const telemetry = createPdfTelemetry('termo_cessao')
  try {
    const context = await requireGestor()

    const { operacao_id } = await req.json()
    if (!operacao_id) return NextResponse.json({ error: 'operacao_id obrigatorio' }, { status: 400 })

    const { url, path } = await gerarTermoCessao(operacao_id, context.user.id, telemetry)
    return NextResponse.json({ url, path, sucesso: true })
  } catch (error: unknown) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    telemetry.failure('PDF_REQUEST_ERROR', error)
    return NextResponse.json({ error: PDF_PUBLIC_ERROR }, { status: 500 })
  }
}
