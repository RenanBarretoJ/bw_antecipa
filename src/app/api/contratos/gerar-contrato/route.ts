import { createPdfTelemetry, PDF_PUBLIC_ERROR } from '@/lib/pdf/pdf-telemetry'
import { NextRequest, NextResponse } from 'next/server'
import { gerarContratoCessao } from '@/lib/pdf/gerarContrato'
import { AuthorizationError, requireGestor } from '@/lib/auth/authorization'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const telemetry = createPdfTelemetry('contrato_mae')
  try {
    const context = await requireGestor()

    const { cedente_id } = await req.json()
    if (!cedente_id) return NextResponse.json({ error: 'cedente_id obrigatorio' }, { status: 400 })

    const { url, path } = await gerarContratoCessao(cedente_id, context.user.id, telemetry)
    return NextResponse.json({ url, path, sucesso: true })
  } catch (error: unknown) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    telemetry.failure('PDF_REQUEST_ERROR', error)
    return NextResponse.json({ error: PDF_PUBLIC_ERROR }, { status: 500 })
  }
}
