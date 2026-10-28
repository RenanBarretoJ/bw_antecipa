import 'server-only'
import { z } from 'zod'
import { readSerproNfeRuntimeConfig, SerproNfeError, type SerproNfeRuntimeConfig } from './provider.server'

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}
const grantSchema = z.object({ code: z.string(), ticket: z.string().uuid().optional() })

/** Every actual OAuth and fiscal fetch goes through the same durable credential
 * mutex. A committed authorization may precede a crash: that state is retained
 * as uncertain, never treated as proof of a billed request or safe retry. */
export function createOperationalFetcher(
  db: RpcClient,
  job: { execution_id: string; lease_token: string },
  config: SerproNfeRuntimeConfig,
  fetcher: typeof fetch = fetch,
  pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
): typeof fetch {
  return async (input, init) => {
    const url = String(input)
    const phase = url === config.tokenUrl ? 'OAUTH'
      : url.startsWith(config.queryBaseUrl) ? 'GET_NFE' : null
    if (!phase) throw new SerproNfeError('UNEXPECTED_OUTBOUND')
    let ticket: string | undefined
    for (let attempt = 0; attempt < 300; attempt++) {
      if (!readSerproNfeRuntimeConfig().ready) throw new SerproNfeError('CAPABILITY_UNVERIFIED')
      init?.signal?.throwIfAborted()
      const grant = await db.rpc('nfe_fiscal_operational_http_begin', {
        p_execution_id: job.execution_id, p_lease_token: job.lease_token, p_phase: phase,
      })
      if (grant.error) throw new SerproNfeError('OUTBOUND_GATE_UNAVAILABLE')
      const parsed = grantSchema.safeParse(grant.data)
      if (!parsed.success) throw new SerproNfeError('OUTBOUND_GATE_INVALID')
      if (parsed.data.code === 'AUTHORIZED' && parsed.data.ticket) {
        ticket = parsed.data.ticket
        break
      }
      if (parsed.data.code !== 'WAIT') throw new SerproNfeError('OUTBOUND_DENIED')
      await pause(100)
    }
    if (!ticket) throw new SerproNfeError('OUTBOUND_BACKPRESSURE')
    // No automatic retry here. A failure after this point may have sent bytes.
    const response = await fetcher(input, init)
    const observed = await db.rpc('nfe_fiscal_operational_http_observed', {
      p_ticket: ticket, p_lease_token: job.lease_token, p_http_status: response.status,
    })
    if (observed.error || observed.data !== true) throw new SerproNfeError('HTTP_OBSERVATION_UNCERTAIN')
    return response
  }
}
