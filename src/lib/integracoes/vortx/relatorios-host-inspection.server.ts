import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { readBoundedBody } from '@/lib/email-intake/providers/graph-http.server'
import { abrirEventoPreservado, eventoPreservadoSchema } from './relatorios-evento-preservado.server'
import { relatoriosPreviewPermitidos } from './relatorios-operacao'

const configSchema = z.object({
  segredoHash: z.string().regex(/^[a-f0-9]{64}$/),
  inicio: z.iso.datetime(), fim: z.iso.datetime(),
  eventos: z.array(z.uuid()).min(1).max(4).refine(ids => new Set(ids).size === ids.length),
}).strict()

type Ambiente = Readonly<Record<string, string | undefined>>
type Leitor = (fundoId: string, ids: string[]) => Promise<unknown[]>
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
const reply = (status: number) => new Response(null, { status, headers })

async function lerEventos(fundoId: string, ids: string[]): Promise<unknown[]> {
  const result = await createAdminClient().from('vortx_relatorio_eventos')
    .select('id,endpoint_id,fundo_id,ambiente,hash_evento,payload_criptografado,chave_versao,correlacao')
    .eq('fundo_id', fundoId).in('id', ids).limit(4)
  if (result.error || !result.data) throw new Error('HOST_INSPECTION_UNAVAILABLE')
  return result.data
}

function configuracao(env: Ambiente, now: number) {
  try {
    const fundoId = z.uuid().parse(env.VORTX_REPORTS_PREVIEW_FUNDO_ID)
    if (!relatoriosPreviewPermitidos(fundoId, env)) return null
    const config = configSchema.parse(JSON.parse(env.VORTX_REPORT_HOST_INSPECTION_JSON ?? ''))
    const inicio = Date.parse(config.inicio), fim = Date.parse(config.fim)
    if (fim <= inicio || fim - inicio > 60 * 60 * 1000 || now < inicio || now >= fim) return null
    return { ...config, fundoId }
  } catch { return null }
}

/** Read-only, operator-authorized Preview inspection. Not an importer or a user/MFA substitute.
 * Only an expiring machine credential can inspect explicitly listed preserved events.
 * Never exports keyring, ciphertext, original JSON, signed URL, path, query or headers.
 * Observing a host does NOT authorize it for downloads or resolve PENDENTE correlation.
 */
export async function inspecionarHostsPreservados(request: Request, options: {
  env?: Ambiente; now?: number; ler?: Leitor
} = {}): Promise<Response> {
  const config = configuracao(options.env ?? process.env, options.now ?? Date.now())
  if (!config) return reply(404)
  const auth = request.headers.get('authorization') ?? ''
  if (!/^Bearer [a-f0-9]{64}$/.test(auth)) return reply(401)
  const hash = createHash('sha256').update(auth.slice(7)).digest()
  if (!timingSafeEqual(hash, Buffer.from(config.segredoHash, 'hex'))) return reply(401)
  if (request.method !== 'POST') return reply(405)
  if (new URL(request.url).search) return reply(400)
  // The hosted adapter can represent an empty POST as a non-null, empty stream.
  // Permit zero bytes only; do not accept any caller payload or caller-selected event IDs.
  try {
    if (request.body) await readBoundedBody(new Response(request.body, { headers: request.headers }), 0)
  } catch { return reply(400) }
  try {
    const rows = z.array(eventoPreservadoSchema).length(config.eventos.length).parse(await (options.ler ?? lerEventos)(config.fundoId, config.eventos))
    if (new Set(rows.map(row => row.id)).size !== rows.length) return reply(409)
    const hosts = rows.map(row => {
      if (row.fundo_id !== config.fundoId || !config.eventos.includes(row.id)) throw new Error('SCOPE')
      const { evento } = abrirEventoPreservado(row)
      const url = new URL(evento.urlRelatorio!)
      return { tipo: evento.tipoRelatorio, hostname: url.hostname, porta: url.port || '443',
        expiracao: evento.dataExpiracao, correlacao: row.correlacao }
    })
    return Response.json({ hosts, somenteLeitura: true, downloadAutorizado: false }, { headers })
  } catch { return reply(503) } // Never propagate a decryption, schema, provider or database exception.
}
