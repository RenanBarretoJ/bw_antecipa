import { NextRequest, NextResponse } from 'next/server'
import { AuthorizationError } from '@/lib/auth/authorization'
import { anexarContratoAssinadoCedente, autorizarContratoAssinadoCedente } from '@/lib/contratos/contrato-assinado.server'
import { MAX_CONTRATO_ASSINADO_BYTES } from '@/lib/contratos/contrato-assinado-config'
import { DocumentoAssinadoOperacaoError } from '@/lib/operacoes/documentos-assinados'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Upload e same-origin, nao ha CORS nem dados de Storage enviados pelo cliente.
    if (request.headers.get('origin') !== request.nextUrl.origin) {
      return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403 })
    }
    const { id } = await params
    await autorizarContratoAssinadoCedente(id)
    if (Number(request.headers.get('content-length')) > MAX_CONTRATO_ASSINADO_BYTES + 64 * 1024) {
      return NextResponse.json({ error: 'O contrato excede o limite de 4 MB.' }, { status: 413 })
    }
    let form: FormData
    try { form = await request.formData() } catch {
      return NextResponse.json({ error: 'Envie um arquivo PDF válido.' }, { status: 400 })
    }
    const arquivo = form.get('arquivo')
    if (!(arquivo instanceof File) || form.getAll('arquivo').length !== 1 || [...form.keys()].some(key => key !== 'arquivo')) {
      return NextResponse.json({ error: 'Envie somente um arquivo PDF.' }, { status: 400 })
    }
    return NextResponse.json(await anexarContratoAssinadoCedente(id, arquivo), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof DocumentoAssinadoOperacaoError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[api/cedentes/contrato-assinado] falha no salvamento')
    return NextResponse.json({ error: 'Não foi possível salvar o contrato assinado. Atualize a página antes de tentar novamente.' }, { status: 500 })
  }
}
