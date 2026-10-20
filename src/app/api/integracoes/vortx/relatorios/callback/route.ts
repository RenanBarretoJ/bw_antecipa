import { callbackPreviewPermitido } from '@/lib/integracoes/vortx/relatorios-callback'
import { receberCallbackRelatorio, type CallbackReceiptDiagnostic } from '@/lib/integracoes/vortx/relatorios-callback-handler.server'
import { criarRepositorioCallbackRelatorio } from '@/lib/integracoes/vortx/relatorios-callback-repository.server'
import { iniciarCapturaCallback } from '@/lib/integracoes/vortx/relatorios-callback-capture.server'

export const maxDuration = 10

export async function POST(request: Request) {
  if (!callbackPreviewPermitido()) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  const started = Date.now()
  const capturar = iniciarCapturaCallback(request)
  let result: Response
  let diagnostico: CallbackReceiptDiagnostic | { etapa: 'ROTA'; motivo: 'FALHA_INESPERADA' } | undefined
  try {
    result = await receberCallbackRelatorio(request, criarRepositorioCallbackRelatorio(), process.env.VORTX_REPORTS_PREVIEW_FUNDO_ID!, value => { diagnostico = value })
  } catch {
    diagnostico = { etapa: 'ROTA', motivo: 'FALHA_INESPERADA' }
    result = new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
  }
  const captura = capturar ? await capturar(result.status) : undefined
  if (captura) console.info('vortx_callback_private_capture', captura)
  // Never log Request, URL, query, headers, payload, ciphertext or exception messages.
  console.info('vortx_callback_receipt', { status: result.status, durationMs: Date.now() - started, ...diagnostico })
  return result
}
