import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { validarPayloadComprovanteWebhook } from '@/lib/integracoes/webhook-comprovante-transportadora-payload'
import { processarWebhookComprovanteTransportadora, resolverIntegracaoPorToken } from '@/lib/integracoes/webhook-comprovante-transportadora.server'

// POST /api/integracoes/transportadoras/[provider]/comprovantes-entrega
// Webhook provider-agnostic para ingestao automatica de comprovante de
// entrega. Ver docs/integracoes/webhook-comprovante-transportadora.md.
//
// Auth: Authorization: Bearer <token> -- token identifica integracao +
// fundo + provider (nunca escolhido pelo payload). Sem HMAC neste MVP.
//
// Contrato de resposta: qualquer resultado de NEGOCIO (match ambiguo, NF
// nao encontrada, canhoto ja aprovado, sem entrega ainda, processado com
// sucesso, duplicado) volta como 200 -- a requisicao em si foi valida e
// foi registrada no inbox para auditoria/retry seguro (idempotency_key).
// So problemas da PROPRIA requisicao (auth, formato do payload, MIME
// declarado fora do allowlist, payload grande demais) voltam 4xx; erros
// internos/transitorios voltam 5xx (retry-worthy).

const MAX_BODY_BYTES = 20 * 1024 * 1024

type RouteContext = { params: Promise<{ provider: string }> }

function erroJson(status: number, codigo: string, mensagem: string) {
  return NextResponse.json({ success: false, codigo, mensagem }, { status })
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { provider } = await context.params
    if (!provider || !/^[a-z0-9_-]{2,64}$/.test(provider)) {
      return erroJson(400, 'PROVIDER_INVALIDO', 'Provider da rota invalido.')
    }

    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
    if (!token) {
      return erroJson(401, 'TOKEN_AUSENTE', 'Cabecalho Authorization: Bearer <token> e obrigatorio.')
    }

    const rawBody = await request.text()
    if (rawBody.length > MAX_BODY_BYTES) {
      return erroJson(413, 'PAYLOAD_MUITO_GRANDE', `Corpo da requisicao excede o limite de ${MAX_BODY_BYTES} bytes.`)
    }

    const integracao = await resolverIntegracaoPorToken(token, provider)
    if (!integracao) {
      return erroJson(401, 'TOKEN_INVALIDO', 'Token invalido, inativo ou nao corresponde ao provider informado na rota.')
    }

    let payloadJson: unknown
    try {
      payloadJson = rawBody ? JSON.parse(rawBody) : null
    } catch {
      return erroJson(400, 'JSON_INVALIDO', 'Corpo da requisicao nao e um JSON valido.')
    }

    const validacao = validarPayloadComprovanteWebhook(payloadJson)
    if (!validacao.ok) {
      return erroJson(400, validacao.codigo, validacao.mensagem)
    }

    const payloadHash = createHash('sha256').update(rawBody, 'utf8').digest('hex')
    const resultado = await processarWebhookComprovanteTransportadora(integracao, validacao.data, payloadHash)

    const statusRetriavel = resultado.status === 'ERRO_REPROCESSAVEL'
    const statusNaoRetriavel = resultado.status === 'ERRO_FINAL'
    const httpStatus = statusRetriavel ? 503 : statusNaoRetriavel ? 422 : 200

    return NextResponse.json(
      {
        success: !statusRetriavel && !statusNaoRetriavel,
        status: resultado.status,
        webhook_evento_id: resultado.webhookEventoId,
        canhoto_id: resultado.canhotoId,
        detalhe: resultado.detalhe,
      },
      { status: httpStatus },
    )
  } catch (error) {
    console.error('[api/integracoes/transportadoras/comprovantes-entrega] falha inesperada', {
      erro: error instanceof Error ? error.message : 'erro_desconhecido',
    })
    return erroJson(500, 'ERRO_INTERNO', 'Nao foi possivel processar o webhook.')
  }
}
