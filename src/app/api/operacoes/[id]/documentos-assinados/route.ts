import { NextResponse } from 'next/server'
import {
  anexarDocumentoAssinadoOperacao,
  criarUrlDocumentoAssinadoOperacao,
} from '@/lib/operacoes/documentos-assinados.server'
import {
  DocumentoAssinadoOperacaoError,
  isTipoDocumentoAssinadoOperacao,
} from '@/lib/operacoes/documentos-assinados'

type RouteContext = { params: Promise<{ id: string }> }

function respostaErro(error: unknown) {
  if (error instanceof DocumentoAssinadoOperacaoError) {
    return NextResponse.json(
      { success: false, message: error.message, code: error.code },
      { status: error.status },
    )
  }

  console.error('[api/operacoes/documentos-assinados] falha inesperada', {
    erro: error instanceof Error ? error.message : 'erro_desconhecido',
  })
  return NextResponse.json(
    { success: false, message: 'Nao foi possivel processar o documento.' },
    { status: 500 },
  )
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: operacaoId } = await context.params
    const formData = await request.formData()
    const tipo = formData.get('tipoDocumento')
    const arquivo = formData.get('arquivo')

    if (!isTipoDocumentoAssinadoOperacao(tipo)) {
      throw new DocumentoAssinadoOperacaoError('Tipo de documento invalido.', 400, 'INVALID_DOCUMENT_TYPE')
    }
    if (!(arquivo instanceof File)) {
      throw new DocumentoAssinadoOperacaoError('Arquivo PDF obrigatorio.', 400, 'FILE_REQUIRED')
    }

    const resultado = await anexarDocumentoAssinadoOperacao({ operacaoId, tipo, arquivo })
    return NextResponse.json({
      success: true,
      tipo: resultado.tipo,
      updatedAt: resultado.atualizadoEm,
      replaced: resultado.substituiu,
      message: resultado.substituiu ? 'Documento substituido com sucesso.' : 'Documento enviado com sucesso.',
    })
  } catch (error) {
    return respostaErro(error)
  }
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id: operacaoId } = await context.params
    const tipo = new URL(request.url).searchParams.get('tipoDocumento')
    if (!isTipoDocumentoAssinadoOperacao(tipo)) {
      throw new DocumentoAssinadoOperacaoError('Tipo de documento invalido.', 400, 'INVALID_DOCUMENT_TYPE')
    }

    const resultado = await criarUrlDocumentoAssinadoOperacao({ operacaoId, tipo })
    return NextResponse.json({
      success: true,
      url: resultado.url,
      expiresIn: resultado.expiraEmSegundos,
    })
  } catch (error) {
    return respostaErro(error)
  }
}
