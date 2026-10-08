import 'server-only'
import { z } from 'zod'
import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { createAdminClient } from '@/lib/supabase/server'
import { FiscalIntakeError, type FiscalClaim } from './contracts'
import type { FiscalImportRepository } from './service.server'
import { processFiscalCleanup } from './storage.server'

const uuid = z.string().uuid()
const claimSchema = z.object({ id: uuid, token: uuid, generation: z.number().int().positive() })
const unavailableSchema = z.object({ status: z.enum(['DUPLICATE', 'IN_PROGRESS', 'CLEANUP_PENDING']) })
const reservationSchema = z.union([claimSchema, unavailableSchema])
const scopeSchema = z.union([
  z.object({ fundoId: uuid, cedenteId: uuid, cedenteFundoId: uuid, estabelecimentoId: uuid, cnpj: z.string().regex(/^\d{14}$/), razaoSocial: z.string() }),
  z.object({ status: z.enum(['UNKNOWN_CEDENTE', 'ROUTING_DENIED', 'AMBIGUOUS']) }),
])
const storageSchema = z.object({ id: uuid, bucket: z.enum(['notas-fiscais', 'documentos-v2']), path: z.string().min(1) })
const importedSchema = z.object({ nfId: uuid, numero: z.string() })
const recoverySchema = z.object({ status: z.enum(['IMPORTED', 'FAILED', 'CLEANUP_PENDING']), nfId: uuid.optional(), numero: z.string().optional() })
const companionResultSchema = z.union([
  z.object({ status: z.literal('CREATE_NF') }),
  z.object({ status: z.literal('DOCUMENT'), claim: claimSchema, intent: storageSchema }),
  z.object({ status: z.literal('COMPANION_LINKED'), nfId: uuid, numero: z.string() }),
  z.object({ status: z.enum(['WAITING_CANONICAL_XML', 'AMBIGUOUS', 'IN_PROGRESS', 'CLEANUP_PENDING', 'DUPLICATE']) }),
])
const fence = (claim: FiscalClaim) => ({ p_id: claim.id, p_token: claim.token, p_generation: claim.generation })
function check(error: { code?: string } | null) {
  if (!error) return
  // RPCs deliberately use closed SQLSTATEs; never expose database messages.
  if (error.code === '42501') throw new FiscalIntakeError('DENIED')
  if (error.code === '22023') throw new FiscalIntakeError('INVALID')
  throw new FiscalIntakeError('INFRASTRUCTURE')
}

export function createFiscalImportRepository(client: AppSupabaseClient): FiscalImportRepository {
  return {
    async companion(input, scope, facts, sha256) {
      const { data, error } = await client.rpc('fiscal_intake_prepare_companion', {
        p_actor: input.actor, p_fundo_id: scope.fundoId, p_cedente_fundo_id: scope.cedenteFundoId,
        p_estabelecimento_id: scope.estabelecimentoId, p_fiscal_key: facts.key, p_file_sha256: sha256,
        p_document_code: facts.kind === 'XML' ? 'nf_xml' : 'nf_danfe_pdf', p_facts: facts.parsed,
        p_file_name: input.file.name.slice(0, 255), p_size_bytes: input.file.size,
      })
      check(error)
      const result = companionResultSchema.parse(data)
      if (result.status === 'CREATE_NF') return { kind: 'CREATE_NF' }
      if (result.status === 'DOCUMENT') return { kind: 'DOCUMENT', claim: result.claim, intent: result.intent }
      return result
    },
    async commitCompanion(claim) {
      const { data, error } = await client.rpc('fiscal_intake_commit_companion', fence(claim))
      check(error)
      return z.object({ status: z.literal('COMPANION_LINKED'), nfId: uuid, numero: z.string() }).parse(data)
    },
    async failCompanion(claim) {
      const { data, error } = await client.rpc('fiscal_intake_abort_companion', fence(claim))
      check(error)
      return z.union([z.object({status:z.literal('COMPANION_LINKED'),nfId:uuid,numero:z.string()}),
        z.object({status:z.enum(['CLEANUP_PENDING','FAILED'])})]).parse(data)
    },
    async resolveScope(input, facts) {
      const { data, error } = await client.rpc('fiscal_intake_resolve_scope', { p_actor: input.actor, p_fundo_id: input.fundoId,
        p_issuer_cnpj: facts.issuerCnpj, p_cedente_fundo_id: input.cedenteFundoId ?? null })
      check(error)
      return scopeSchema.parse(data)
    },
    async reserve(input, scope, facts, sha256) {
      const { data, error } = await client.rpc('fiscal_intake_reserve', { p_actor: input.actor, p_fundo_id: scope.fundoId,
        p_cedente_fundo_id: scope.cedenteFundoId, p_estabelecimento_id: scope.estabelecimentoId,
        p_document_type: facts.documentType, p_fiscal_key: facts.key, p_file_sha256: sha256, p_recover_xml: facts.kind === 'XML' })
      check(error)
      return reservationSchema.parse(data)
    },
    async resumeReview(input, scope, facts, sha256, fingerprint) {
      if (!input.review || input.actor.type !== 'HUMAN') throw new FiscalIntakeError('DENIED')
      const { data, error } = await client.rpc('fiscal_intake_resume_review', { p_review_id: input.review.intentId,
        p_fundo_id: scope.fundoId, p_cedente_fundo_id: scope.cedenteFundoId, p_file_sha256: sha256,
        p_fiscal_sha256: fingerprint, p_fiscal_key: facts.key })
      check(error)
      return reservationSchema.parse(data)
    },
    async openReview(claim, fingerprint) {
      const { data, error } = await client.rpc('fiscal_intake_open_review', { ...fence(claim), p_fiscal_sha256: fingerprint })
      check(error)
      return uuid.parse(data)
    },
    async planStorage(claim, file, facts, prepared) {
      const { error: stageError } = await createAdminClient().rpc('fiscal_intake_stage', { ...fence(claim),
        p_values: prepared.values, p_parcelas: prepared.parcelas, p_file_name: file.name.slice(0, 255),
        p_mime_type: facts.kind === 'XML' ? 'application/xml' : 'application/pdf', p_size_bytes: file.size,
        p_document_code: facts.kind === 'XML' ? 'nf_xml' : 'nf_danfe_pdf' })
      check(stageError)
      const { data, error } = await client.rpc('fiscal_intake_prepare_storage', fence(claim))
      check(error)
      return storageSchema.parse(data)
    },
    async commit(claim, intent) {
      const { data, error } = await client.rpc('fiscal_intake_commit', { ...fence(claim), p_storage_intent_id: intent.id })
      check(error)
      return importedSchema.parse(data)
    },
    async fail(claim) {
      const admin = createAdminClient()
      const { data, error } = await admin.rpc('fiscal_intake_abort', fence(claim))
      check(error)
      const result = recoverySchema.parse(data)
      if (result.status !== 'CLEANUP_PENDING') return result
      await processFiscalCleanup(10, claim.id)
      const { data: refreshed, error: refreshError } = await admin.rpc('fiscal_intake_abort', fence(claim))
      check(refreshError)
      return recoverySchema.parse(refreshed)
    },
  }
}
