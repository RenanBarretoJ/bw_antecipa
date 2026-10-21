import { callbackPreviewPermitido } from '@/lib/integracoes/vortx/relatorios-callback'
import { receberCallbackRelatorio, type CallbackReceiptDiagnostic } from '@/lib/integracoes/vortx/relatorios-callback-handler.server'
import { criarRepositorioCallbackRelatorio } from '@/lib/integracoes/vortx/relatorios-callback-repository.server'
import { after } from 'next/server'
import { processarProximoEstoqueVortx, processamentoEstoquePreviewPermitido } from '@/lib/integracoes/vortx/estoque-processamento.server'
import { processarProximaInclusaoVortx, processamentoInclusaoPreviewPermitido } from '@/lib/integracoes/vortx/inclusao-processamento.server'

export const maxDuration = 300

export async function POST(request: Request) {
  if (!callbackPreviewPermitido()) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  const started = Date.now()
  let result: Response
  let diagnostico: CallbackReceiptDiagnostic | { etapa: 'ROTA'; motivo: 'FALHA_INESPERADA' } | undefined
  try {
    result = await receberCallbackRelatorio(request, criarRepositorioCallbackRelatorio(), process.env.VORTX_REPORTS_PREVIEW_FUNDO_ID!, value => { diagnostico = value })
  } catch {
    diagnostico = { etapa: 'ROTA', motivo: 'FALHA_INESPERADA' }
    result = new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
  }
  // Never log Request, URL, query, headers, payload, ciphertext or exception messages.
  console.info('vortx_callback_receipt', { status: result.status, durationMs: Date.now() - started, ...diagnostico })
  if (result.status === 200 && processamentoEstoquePreviewPermitido()) {
    // Receipt has already committed. Scheduling failure must never change its acknowledgement.
    try { after(async () => {
      try { console.info('vortx_stock_processing', await processarProximoEstoqueVortx()) }
      catch { console.warn('vortx_stock_processing', { estado: 'RECONCILIAR_EXECUCAO' }) }
    }) } catch { console.warn('vortx_stock_processing', { estado: 'AGENDAMENTO_INDISPONIVEL' }) }
  }
  if (result.status === 200 && processamentoInclusaoPreviewPermitido()) {
    try { after(async () => {
      try { console.info('vortx_inclusion_processing', await processarProximaInclusaoVortx()) }
      catch { console.warn('vortx_inclusion_processing', { estado: 'RECONCILIAR_EXECUCAO' }) }
    }) } catch { console.warn('vortx_inclusion_processing', { estado: 'AGENDAMENTO_INDISPONIVEL' }) }
  }
  return result
}
