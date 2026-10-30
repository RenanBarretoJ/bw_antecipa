import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { readSerproNfeRuntimeConfig } from './provider.server'

const countSchema = z.number().int().nonnegative().safe()
const timestampSchema = z.string().refine(value => Number.isFinite(Date.parse(value)))
const providerSchema = z.object({
  capability_state: z.enum(['UNVERIFIED', 'VERIFIED_DISABLED', 'ENABLED']),
  consumption_mode: z.enum(['OFF_ZERO_BUDGET', 'UNLIMITED_WITH_METERING', 'LIMITED']),
  circuit_state: z.enum(['OPEN', 'HALF_OPEN', 'CLOSED']),
  cutover_at: timestampSchema.nullable(),
  oauth_dispatch_count: countSchema,
  get_dispatch_count: countSchema,
  http_response_count: countSchema,
  estimated_unit_cost: z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/)]).nullable(),
  cost_currency: z.literal('BRL'),
})
export interface SerproQueueObservationInput {
  provider: unknown
  pending: unknown
  inProgress: unknown
  failed: unknown
  oldestPendingAt: unknown
}
interface QueryResult { data: unknown; count?: number | null; error: unknown }
interface MetricsQuery extends PromiseLike<QueryResult> {
  eq(column: string, value: unknown): MetricsQuery
  gte(column: string, value: string): MetricsQuery
  in(column: string, values: string[]): MetricsQuery
  order(column: string, options: { ascending: boolean }): MetricsQuery
  limit(value: number): MetricsQuery
  maybeSingle(): PromiseLike<QueryResult>
}
interface MetricsDb {
  from(table: string): { select(columns: string, options?: { count: 'exact'; head?: true }): MetricsQuery }
}

async function loadQueueObservation(): Promise<SerproQueueObservationInput> {
  // Internal worker telemetry only. No user route receives a privileged client;
  // the dormant feature and cron authentication are checked before this reader.
  const db = createAdminClient() as unknown as MetricsDb
  const row = await db.from('nfe_fiscal_provider_state').select(
    'capability_state,consumption_mode,circuit_state,cutover_at,oauth_dispatch_count,get_dispatch_count,http_response_count,estimated_unit_cost,cost_currency',
  ).eq('provider', 'SERPRO').maybeSingle()
  if (row.error) throw new Error('SERPRO_METRICS_UNAVAILABLE')
  const provider = providerSchema.parse(row.data)
  // Without a cutover no execution can belong to the operational cohort.
  if (!provider.cutover_at) return { provider, pending: 0, inProgress: 0, failed: 0, oldestPendingAt: null }
  const cutover = provider.cutover_at
  const base = (columns: string, options?: { count: 'exact'; head?: true }) => db.from('nfe_fiscal_execucoes')
    .select(columns, options).eq('eligible_post_cutover', true).gte('requested_at', cutover)
  const statuses = ['SOLICITADA', 'INDISPONIVEL']
  // Count and oldest row share one PostgREST query/snapshot. Separate requests
  // could falsely report an inconsistent queue while another worker drains it.
  const [pending, inProgress, failed] = await Promise.all([
    base('requested_at', { count: 'exact' }).in('status', statuses)
      .order('requested_at', { ascending: true }).limit(1).maybeSingle(),
    base('id', { count: 'exact', head: true }).eq('status', 'EM_PROCESSAMENTO'),
    base('id', { count: 'exact', head: true }).eq('status', 'FALHOU'),
  ])
  if ([pending, inProgress, failed].some(result => result.error)) throw new Error('SERPRO_METRICS_UNAVAILABLE')
  const oldestRow = z.object({ requested_at: timestampSchema }).nullable().parse(pending.data)
  return { provider, pending: pending.count, inProgress: inProgress.count, failed: failed.count,
    oldestPendingAt: oldestRow?.requested_at ?? null }
}

export async function readSerproNfeQueueMetrics(dependencies: {
  load?: () => Promise<SerproQueueObservationInput>
  now?: () => number
} = {}) {
  if (!readSerproNfeRuntimeConfig().ready) return { state: 'OFF' as const }
  const input = await (dependencies.load ?? loadQueueObservation)()
  const provider = providerSchema.parse(input.provider)
  const pending = countSchema.parse(input.pending)
  const inProgress = countSchema.parse(input.inProgress)
  const failed = countSchema.parse(input.failed)
  const oldest = timestampSchema.nullable().parse(input.oldestPendingAt)
  if ((pending === 0) !== (oldest === null)) throw new Error('SERPRO_METRICS_INCONSISTENT')
  const observedAt = (dependencies.now ?? Date.now)()
  if (!Number.isFinite(observedAt)) throw new Error('SERPRO_METRICS_CLOCK_INVALID')
  const ageMs = oldest === null ? null : observedAt - Date.parse(oldest)
  const clockSkew = ageMs !== null && ageMs < 0
  const oldestWaitSeconds = ageMs === null || clockSkew ? null : Math.floor(ageMs / 1000)
  return {
    state: 'OBSERVED' as const, observedAt: new Date(observedAt).toISOString(),
    pending, inProgress, failed, oldestWaitSeconds, clockSkew,
    agingAlert: ageMs !== null && ageMs > 300_000,
    capabilityState: provider.capability_state, consumptionMode: provider.consumption_mode,
    circuitState: provider.circuit_state,
    oauthAuthorizations: provider.oauth_dispatch_count,
    nfeAuthorizations: provider.get_dispatch_count,
    httpResponsesObserved: provider.http_response_count,
    estimatedUnitCost: provider.estimated_unit_cost,
    estimateAvailable: provider.estimated_unit_cost !== null,
    costCurrency: provider.cost_currency, actualChargeVerified: false as const,
  }
}
