import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import type { NfseExtraction } from './contracts'
import { fiscalFingerprint, nfseIdentity, sha256 } from './review-facts'

export type ReviewScope = { actorId: string; cedenteId: string; cedenteFundoId: string; fundoId: string }
export type NfseReviewIntent = {
  id: string; actor_id: string; cedente_id: string; cedente_fundo_id: string; fundo_id: string
  file_sha256: string; fiscal_sha256: string; identity_sha256: string
  state: 'REVIEW' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CLEANUP_PENDING'
  storage_path: string | null; document_storage_path: string | null; nf_id: string | null
  created_at: string; updated_at: string; expires_at: string
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Service role is confined to server-owned receipts. It never authorizes a NF write.
// Callers must freshly resolve their authenticated operational context first.
export async function openNfseReview(scope: ReviewScope, extraction: NfseExtraction, fileHash: string) {
  const { data, error } = await createAdminClient().from('nfse_review_intents').insert({
    actor_id: scope.actorId, cedente_id: scope.cedenteId, cedente_fundo_id: scope.cedenteFundoId,
    fundo_id: scope.fundoId, file_sha256: fileHash, fiscal_sha256: fiscalFingerprint(extraction),
    identity_sha256: sha256(nfseIdentity(extraction)),
  }).select('id').single()
  if (error || !data) throw new Error('NFSE_REVIEW_CREATE_FAILED')
  return data.id
}

export async function readNfseReview(id: string, scope: ReviewScope, extraction: NfseExtraction, fileHash: string) {
  if (!uuid.test(id)) throw new Error('NFSE_REVIEW_INVALID')
  const { data, error } = await createAdminClient().from('nfse_review_intents').select('*')
    .eq('id', id).eq('actor_id', scope.actorId).eq('cedente_id', scope.cedenteId)
    .eq('cedente_fundo_id', scope.cedenteFundoId).eq('fundo_id', scope.fundoId).maybeSingle()
  if (error || !data) throw new Error('NFSE_REVIEW_INVALID')
  if (data.file_sha256 !== fileHash || data.fiscal_sha256 !== fiscalFingerprint(extraction)
    || data.identity_sha256 !== sha256(nfseIdentity(extraction))) throw new Error('NFSE_REVIEW_DRIFT')
  if (data.state !== 'REVIEW') throw new Error('NFSE_REVIEW_CONFLICT')
  if (Date.parse(data.expires_at) <= Date.now()) throw new Error('NFSE_REVIEW_EXPIRED')
  return data
}

export async function claimNfseReview(id: string, path: string, nfId: string) {
  const { data, error } = await createAdminClient().from('nfse_review_intents')
    .update({ state: 'PROCESSING', storage_path: path, nf_id: nfId, updated_at: new Date().toISOString() })
    .eq('id', id).eq('state', 'REVIEW').gt('expires_at', new Date().toISOString()).select('id').maybeSingle()
  if (error?.code === '23505' || (!error && !data)) throw new Error('NFSE_REVIEW_CONFLICT')
  if (error) throw new Error('NFSE_REVIEW_CLAIM_FAILED')
}

export async function settleNfseReview(id: string, state: NfseReviewIntent['state'], nfId?: string) {
  const { data, error } = await createAdminClient().from('nfse_review_intents')
    .update({ state, ...(nfId ? { nf_id: nfId } : {}), updated_at: new Date().toISOString() })
    .eq('id', id).eq('state', 'PROCESSING').select('id').maybeSingle()
  if (error || !data) throw new Error('NFSE_REVIEW_SETTLE_FAILED')
}

export async function trackNfseDocumentPath(id: string, path: string) {
  const { data, error } = await createAdminClient().from('nfse_review_intents')
    .update({ document_storage_path: path, updated_at: new Date().toISOString() })
    .eq('id', id).eq('state', 'PROCESSING').select('id').maybeSingle()
  if (error || !data) throw new Error('NFSE_DOCUMENT_PATH_TRACK_FAILED')
}
