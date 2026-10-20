import 'server-only'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { processamentoEstoquePreviewPermitido, processarProximoEstoqueVortx } from './estoque-processamento.server'

/** Explicit machine-operator recovery, not an automatic callback retry.
 * SQL preserves the failed attempt in immutable audit and rechecks scope/absence
 * of any upload intent, staging or financial result before returning to pending.
 */
export async function retomarDownloadEstoqueVortx(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (!processamentoEstoquePreviewPermitido(env)) return { estado: 'DESABILITADO' as const }
  const result = await createAdminClient().rpc('vortx_retomar_download_estoque', {
    p_fundo_id: env.VORTX_REPORTS_PREVIEW_FUNDO_ID!, p_correlation_id: randomUUID(),
  })
  if (result.error || typeof result.data !== 'boolean') throw new Error('RECUPERACAO_INDISPONIVEL')
  if (!result.data) return { estado: 'AGUARDANDO_PAR' as const }
  return processarProximoEstoqueVortx(env)
}
