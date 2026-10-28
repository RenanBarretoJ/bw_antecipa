import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import type { FiscalSnapshot } from './contracts'
import { validarChaveNfe55 } from './key'
import { mapSerproNfeResponse } from './mapper'
import { querySerproNfe, readSerproNfeRuntimeConfig, SerproNfeError } from './provider.server'

const PILOT_PROVIDER_STAGE_TIMEOUT_MS = 15_000

export interface SerproNfePilotInput {
  authorizationId: string
  consultaId: string
  fundoId: string
  notaFiscalId: string
  chaveAcesso: string
  nonceHash: string
  operadorId: string
}

interface ClaimedPilotJob {
  authorization_id: string
  consulta_id: string
  snapshot_id: string
  fundo_id: string
  nota_fiscal_id: string
  lease_token: string
}

interface SnapshotRow {
  chave_acesso: string
  modelo: string
  numero_nf: string
  serie: string
  cnpj_emitente: string
  cnpj_destinatario: string
  data_emissao: string
  valor_total: string | number
}

interface AdminDb {
  rpc(name: string, args?: Record<string, unknown>): Promise<{
    data: unknown
    error: { message: string } | null
  }>
  from(name: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>
      }
    }
  }
}

function claimedIdentityMatches(job: ClaimedPilotJob, input: SerproNfePilotInput) {
  return job.authorization_id === input.authorizationId
    && job.consulta_id === input.consultaId
    && job.fundo_id === input.fundoId
    && job.nota_fiscal_id === input.notaFiscalId
    && Boolean(job.snapshot_id && job.lease_token)
}

export async function runSerproNfePilotOnce(
  input: SerproNfePilotInput,
  dependencies?: {
    db?: AdminDb
    query?: typeof querySerproNfe
    now?: () => Date
  },
) {
  const config = readSerproNfeRuntimeConfig()
  if (!config.ready) {
    return { processed: 0, skipped: 'CAPABILITY_UNVERIFIED' as const }
  }

  const db = dependencies?.db ?? createAdminClient() as unknown as AdminDb
  const query = dependencies?.query ?? querySerproNfe
  const now = dependencies?.now ?? (() => new Date())
  const claimed = await db.rpc('nfe_fiscal_pilot_claim', {
    p_authorization_id: input.authorizationId,
    p_consulta_id: input.consultaId,
    p_fundo_id: input.fundoId,
    p_nota_fiscal_id: input.notaFiscalId,
    p_chave_acesso: input.chaveAcesso,
    p_nonce_hash: input.nonceHash,
    p_operador_id: input.operadorId,
  })
  if (claimed.error) throw new Error('SERPRO_PILOT_CLAIM_FAILED')
  const jobs = Array.isArray(claimed.data) ? claimed.data as ClaimedPilotJob[] : []
  if (jobs.length !== 1) {
    return { processed: 0, skipped: 'PILOT_CLAIM_REJECTED' as const }
  }

  const job = jobs[0]
  let providerAttempted = false
  try {
    if (!claimedIdentityMatches(job, input)) {
      throw new SerproNfeError('PILOT_IDENTITY_MISMATCH')
    }
    const snapshotResult = await db.from('nfe_fiscal_snapshots').select(
      'chave_acesso,modelo,numero_nf,serie,cnpj_emitente,cnpj_destinatario,data_emissao,valor_total',
    ).eq('id', job.snapshot_id).maybeSingle()
    if (snapshotResult.error || !snapshotResult.data) {
      throw new SerproNfeError('PILOT_SNAPSHOT_NOT_FOUND')
    }
    const row = snapshotResult.data as SnapshotRow
    if (row.modelo !== '55'
      || row.chave_acesso !== input.chaveAcesso
      || !validarChaveNfe55(row.chave_acesso)) {
      throw new SerproNfeError('PILOT_SNAPSHOT_IDENTITY_MISMATCH')
    }

    const snapshot: FiscalSnapshot = {
      chaveAcesso: row.chave_acesso,
      numeroNf: row.numero_nf,
      serie: row.serie,
      cnpjEmitente: row.cnpj_emitente,
      cnpjDestinatario: row.cnpj_destinatario,
      dataEmissao: row.data_emissao,
      valorTotal: row.valor_total,
    }
    providerAttempted = true
    const response = await query(snapshot.chaveAcesso, {
      ...config,
      timeoutMs: Math.min(config.timeoutMs, PILOT_PROVIDER_STAGE_TIMEOUT_MS),
    })
    const assessment = mapSerproNfeResponse(response.payload, snapshot, now().toISOString())
    const completed = await db.rpc('nfe_fiscal_pilot_complete', {
      p_authorization_id: job.authorization_id,
      p_consulta_id: job.consulta_id,
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
    if (completed.error || completed.data !== true) {
      throw new Error('SERPRO_PILOT_COMPLETE_FAILED')
    }
    return { processed: 1, status: assessment.status, severity: assessment.severity }
  } catch (error) {
    const providerError = error instanceof SerproNfeError
      ? error
      : new SerproNfeError(providerAttempted ? 'PILOT_PROVIDER_OR_MAPPING_ERROR' : 'PILOT_LOCAL_VALIDATION_ERROR')
    const failed = await db.rpc('nfe_fiscal_pilot_fail', {
      p_authorization_id: job.authorization_id,
      p_consulta_id: job.consulta_id,
      p_lease_token: job.lease_token,
      p_error_code: providerError.code,
      p_http_status: providerError.httpStatus ?? null,
    })
    if (failed.error || failed.data !== true) {
      throw new Error('SERPRO_PILOT_FAIL_FENCING_FAILED')
    }
    return { processed: 1, status: 'INCONCLUSIVO' as const }
  }
}
