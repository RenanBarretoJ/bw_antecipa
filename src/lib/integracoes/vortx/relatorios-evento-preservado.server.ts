import 'server-only'
import { z } from 'zod'
import { descriptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import { interpretarCallbackRelatorio, prepararEventoCallback } from './relatorios-callback'

export const eventoPreservadoSchema = z.object({
  id: z.uuid(), endpoint_id: z.uuid(), fundo_id: z.uuid(), ambiente: z.enum(['producao', 'homologacao']),
  hash_evento: z.string().regex(/^[a-f0-9]{64}$/),
  payload_criptografado: z.string().max(40000), chave_versao: z.string().min(1).max(80),
  correlacao: z.enum(['PENDENTE', 'CORRELACIONADO', 'CONFLITANTE']),
})
const envelopeSchema = z.object({
  purpose: z.literal('VORTX_CALLBACK_RELATORIO_V1'), endpointId: z.uuid(), fundoId: z.uuid(),
  ambiente: z.enum(['producao', 'homologacao']), codigoCarteira: z.string().min(1).max(100),
  hash: z.string().regex(/^[a-f0-9]{64}$/), evento: z.unknown(),
}) // Legacy corpoOriginal is ignored, never exported or used as the canonical event.

/** Internal only: the signed URL must never be returned by an action/API or logged. */
export function abrirEventoPreservado(input: unknown) {
  const row = eventoPreservadoSchema.parse(input)
  const envelope = envelopeSchema.parse(JSON.parse(descriptografarPortalFidcValor(row.payload_criptografado, row.chave_versao)))
  const evento = interpretarCallbackRelatorio(envelope.evento)
  if (envelope.endpointId !== row.endpoint_id || envelope.fundoId !== row.fundo_id
    || envelope.ambiente !== row.ambiente || envelope.codigoCarteira !== evento.idCarteira
    || envelope.hash !== row.hash_evento || prepararEventoCallback(row.endpoint_id, evento).hash !== row.hash_evento
    || evento.statusRelatorio !== 'Disponível' || !evento.urlRelatorio) throw new Error('EVENTO_PRESERVADO_INCOMPATIVEL')
  return { row, evento }
}
