import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { criptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import type { CallbackRepository } from './relatorios-callback-handler.server'
import { prepararEventoCallback } from './relatorios-callback'
import { prazoCapturaCallback, prepararDiagnosticoCallback } from './relatorios-callback-diagnostic'

const bindingSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('UNAUTHORIZED') }), z.object({ status: z.literal('RATE_LIMITED') }),
  z.object({ status: z.literal('AUTHORIZED'), endpointId: z.uuid(), fundoId: z.uuid(), ambiente: z.enum(['producao', 'homologacao']),
    codigoCarteira: z.string(), revisao: z.number().int().positive() }),
])

export function criarRepositorioCallbackRelatorio(client = createAdminClient()): CallbackRepository {
  return {
    async diagnosticarRejeicao(binding, segredoHash, rejection, token) {
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
    },
    async autorizar(id, hash) {
      const result = await client.rpc('vortx_autorizar_callback', { p_id: id, p_segredo_hash: hash })
      if (result.error) throw new Error('Callback temporariamente indisponivel.')
      return bindingSchema.parse(result.data)
    },
    async persistir(binding, segredoHash, evento) {
      const { metadados, hash } = prepararEventoCallback(binding.endpointId, evento)
      const sealed = criptografarPortalFidcValor(JSON.stringify({ purpose: 'VORTX_CALLBACK_RELATORIO_V1',
        endpointId: binding.endpointId, fundoId: binding.fundoId, ambiente: binding.ambiente,
        codigoCarteira: binding.codigoCarteira, hash, evento }))
      const result = await client.rpc('vortx_receber_callback', { p_id: binding.endpointId, p_segredo_hash: segredoHash,
        p_revisao: binding.revisao, p_metadados: metadados, p_hash_evento: hash, p_ciphertext: sealed.ciphertext, p_chave_versao: sealed.chaveVersao })
      if (result.error || !z.object({ recebido: z.literal(true), duplicado: z.boolean() }).safeParse(result.data).success) {
        throw new Error('Nao foi possivel confirmar recebimento duravel do callback.')
      }
    },
  }
}
