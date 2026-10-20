// Historical synthetic regression only. Never imported by any application route.
// Preserves the original diagnostic encryption assertions after retiring runtime capture.
import { z } from 'zod'
import type { createAdminClient } from '@/lib/supabase/server'
import type { CallbackRepository } from '@/lib/integracoes/vortx/relatorios-callback-handler.server'
import { prazoCapturaCallback, prepararDiagnosticoCallback } from '@/lib/integracoes/vortx/relatorios-callback-diagnostic'
import { criptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'

export function criarRepositorioDiagnosticoHistorico(client: ReturnType<typeof createAdminClient>): Pick<CallbackRepository, 'diagnosticarRejeicao'> {
  return { async diagnosticarRejeicao(binding, segredoHash, rejection, token) {
    const prazo = prazoCapturaCallback()
    if (!prazo) return
    const { hash, envelope } = prepararDiagnosticoCallback(binding, rejection, token)
    const sealed = criptografarPortalFidcValor(JSON.stringify(envelope))
    const result = await client.rpc('vortx_registrar_callback_rejeitado', {
      p_id: binding.endpointId, p_segredo_hash: segredoHash, p_revisao: binding.revisao,
      p_motivo: rejection.motivo, p_bytes: rejection.bytes, p_hash: hash,
      p_ciphertext: sealed.ciphertext, p_chave_versao: sealed.chaveVersao, p_capturar_ate: prazo,
    })
    if (result.error || !z.object({ estado: z.enum(['SALVO', 'DUPLICADO', 'LIMITE']) }).safeParse(result.data).success) {
      throw new Error('Nao foi possivel registrar diagnostico privado.')
    }
  } }
}
