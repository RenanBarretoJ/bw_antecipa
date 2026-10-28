import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import type { FiscalSnapshot } from './contracts'
import { mapSerproNfeResponse } from './mapper'
import { createOperationalFetcher } from './outbound.server'
import { querySerproNfe, readSerproNfeRuntimeConfig, SerproNfeError } from './provider.server'

interface ClaimedJob {
  execution_id: string
  consulta_id: string
  lease_token: string
  snapshot_id: string
}

interface SnapshotRow {
  chave_acesso: string
  numero_nf: string
  serie: string
  cnpj_emitente: string
  cnpj_destinatario: string
  data_emissao: string
  valor_total: string | number
}

interface AdminDb {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>
  from(name: string): {
    select(columns: string): {
      eq(column: string, value: string): { maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }> }
    }
  }
}

export async function runSerproNfeWorkerOnce(dependencies?: {
  db?: AdminDb
  query?: typeof querySerproNfe
  fetcher?: typeof fetch
  now?: () => Date
}) {
  const config = readSerproNfeRuntimeConfig()
  if (!config.ready) return { processed: 0, skipped: 'CAPABILITY_UNVERIFIED' as const }
  const db = dependencies?.db ?? createAdminClient() as unknown as AdminDb
  const query = dependencies?.query ?? querySerproNfe
  const now = dependencies?.now ?? (() => new Date())
  const recovered = await db.rpc('nfe_fiscal_operational_recover')
  if (recovered.error) throw new Error('SERPRO_QUEUE_RECOVERY_FAILED')
  const claimed = await db.rpc('nfe_fiscal_operational_claim', { p_limit: 1 })
  if (claimed.error) throw new Error('SERPRO_QUEUE_CLAIM_FAILED')
  const jobs = Array.isArray(claimed.data) ? claimed.data as ClaimedJob[] : []
  if (!jobs.length) return { processed: 0, skipped: 'EMPTY_QUEUE' as const }
  const job = jobs[0]
  try {
    const snapshotResult = await db.from('nfe_fiscal_snapshots').select(
      'chave_acesso,numero_nf,serie,cnpj_emitente,cnpj_destinatario,data_emissao,valor_total',
    ).eq('id', job.snapshot_id).maybeSingle()
    if (snapshotResult.error || !snapshotResult.data) throw new Error('SERPRO_SNAPSHOT_NOT_FOUND')
    const row = snapshotResult.data as SnapshotRow
    const snapshot: FiscalSnapshot = {
      chaveAcesso: row.chave_acesso,
      numeroNf: row.numero_nf,
      serie: row.serie,
      cnpjEmitente: row.cnpj_emitente,
      cnpjDestinatario: row.cnpj_destinatario,
      dataEmissao: row.data_emissao,
      valorTotal: row.valor_total,
    }

    const checkedAt = now().toISOString()
    const response = await query(snapshot.chaveAcesso, config,
      createOperationalFetcher(db, job, config, dependencies?.fetcher))
    const assessment = mapSerproNfeResponse(response.payload, snapshot, checkedAt)
    const completed = await db.rpc('nfe_fiscal_operational_complete', {
      p_execution_id: job.execution_id,
      p_lease_token: job.lease_token,
      p_status: assessment.status,
      p_severidade: assessment.severity,
      p_resumo: assessment.summary,
      p_checked_at: assessment.checkedAt,
      p_http_status: response.httpStatus,
      p_response_fingerprint: assessment.responseFingerprint,
      p_resultado_minimo: assessment.result,
      p_divergencias: assessment.differences,
      p_eventos: assessment.events.map(event => ({
        codigo: event.code,
        descricao: event.description,
        protocolo: event.protocol,
        fato_em: event.occurredAt,
        registrado: event.registered,
        severidade: event.severity,
        fingerprint: event.fingerprint,
      })),
    })
    if (completed.error || completed.data !== true) throw new Error('SERPRO_QUEUE_COMPLETE_FAILED')
    return { processed: 1, status: assessment.status, severity: assessment.severity }
  } catch (error) {
    const providerError = error instanceof SerproNfeError ? error : new SerproNfeError('MAPPING_ERROR')
    // A GET, timeout or lost response can be charged. Only a confirmed OAuth
    // rejection is safe for finite automatic retry; SQL rechecks the HTTP audit.
    const retryable = providerError.code.startsWith('TOKEN_HTTP_')
      && (providerError.httpStatus === 429 || (providerError.httpStatus ?? 0) >= 500)
    const failed = await db.rpc('nfe_fiscal_operational_record_failure', {
      p_execution_id: job.execution_id,
      p_lease_token: job.lease_token,
      p_error_code: providerError.code,
      p_http_status: providerError.httpStatus ?? null,
      p_retryable: retryable,
    })
    if (failed.error || failed.data !== true) throw new Error('SERPRO_QUEUE_FAIL_FAILED')
    return { processed: 1, status: retryable ? 'INDISPONIVEL' : 'ERRO' }
  }
}
