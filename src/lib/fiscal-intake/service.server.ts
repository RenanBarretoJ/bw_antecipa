import 'server-only'
import { createHash } from 'node:crypto'
import { fiscalFingerprint } from '@/lib/nfse/review-facts'
import { resolverRazaoSocialDestinatario } from '@/lib/notas-fiscais/destinatario.server'
import { prepareFiscalPersistence } from './prepare'
import { parseFiscalFile } from './parse.server'
import { FiscalIntakeError, type DomainActor, type FiscalClaim, type FiscalFacts, type FiscalImportResult,
  type FiscalScope, type FiscalStorageIntent, type PreparedFiscal } from './contracts'

export type FiscalImportInput = {
  actor: DomainActor; fundoId: string; cedenteFundoId?: string; file: File
  review?: { intentId: string; manualDue: string }
}
type Unavailable = { status: 'DUPLICATE' | 'IN_PROGRESS' | 'CLEANUP_PENDING' }
export interface FiscalImportRepository {
  resolveScope(input: FiscalImportInput, facts: FiscalFacts): Promise<FiscalScope | { status: 'UNKNOWN_CEDENTE' | 'ROUTING_DENIED' | 'AMBIGUOUS' }>
  reserve(input: FiscalImportInput, scope: FiscalScope, facts: FiscalFacts, sha256: string): Promise<FiscalClaim | Unavailable>
  resumeReview(input: FiscalImportInput, scope: FiscalScope, facts: FiscalFacts, sha256: string, fingerprint: string): Promise<FiscalClaim | Unavailable>
  openReview(claim: FiscalClaim, fingerprint: string): Promise<string>
  planStorage(claim: FiscalClaim, file: File, facts: FiscalFacts, prepared: PreparedFiscal): Promise<FiscalStorageIntent>
  commit(claim: FiscalClaim, intent: FiscalStorageIntent, prepared: PreparedFiscal, file: File): Promise<{ nfId: string; numero: string }>
  /** Atomically inspect a potentially committed request before scheduling cleanup. */
  fail(claim: FiscalClaim): Promise<{ status: 'CLEANUP_PENDING' | 'FAILED' | 'IMPORTED'; nfId?: string; numero?: string }>
}
export interface FiscalStorage {
  upload(intent: FiscalStorageIntent, file: File): Promise<void>
}

/** Both entry points use this orchestration. No session, provider, or fake user. */
export async function importFiscalFile(input: FiscalImportInput, dependencies: {
  repository: FiscalImportRepository; storage: FiscalStorage
  parse?: typeof parseFiscalFile; today?: () => string
}): Promise<FiscalImportResult> {
  const { repository, storage } = dependencies
  let claim: FiscalClaim | undefined
  try {
    const facts = await (dependencies.parse ?? parseFiscalFile)(input.file)
    const scope = await repository.resolveScope(input, facts)
    if ('status' in scope) return scope
    const sha256 = createHash('sha256').update(Buffer.from(await input.file.arrayBuffer())).digest('hex')
    if (input.review && (facts.kind !== 'NFSE' || input.actor.type !== 'HUMAN')) return { status: 'INVALID' }
    const reservation = input.review && facts.kind === 'NFSE'
      ? await repository.resumeReview(input, scope, facts, sha256, fiscalFingerprint(facts.parsed))
      : await repository.reserve(input, scope, facts, sha256)
    if ('status' in reservation) return reservation
    claim = reservation
    if (facts.kind === 'DANFE') {
      const recipient = await resolverRazaoSocialDestinatario({ cnpj: facts.parsed.cnpj_destinatario, razaoSocial: facts.parsed.razao_social_destinatario })
      facts.parsed.razao_social_destinatario = recipient.razaoSocial
    }
    const prepared = prepareFiscalPersistence({ facts, scope, sha256,
      today: (dependencies.today ?? (() => new Date().toISOString().slice(0, 10)))(),
      verifiedManualDue: input.review?.manualDue })
    if ('kind' in prepared) {
      if (facts.kind !== 'NFSE') throw new FiscalIntakeError('INVALID')
      const intentId = await repository.openReview(claim, fiscalFingerprint(facts.parsed))
      return { status: 'REQUIRES_REVIEW', review: { ...prepared.review, intentId } }
    }
    // The loser never reaches planStorage or upload. Persistence owns its atomic
    // NF/parcel/document/audit/attachment commit and rechecks the same fence.
    const intent = await repository.planStorage(claim, input.file, facts, prepared)
    await storage.upload(intent, input.file)
    const result = await repository.commit(claim, intent, prepared, input.file)
    return { status: 'IMPORTED', ...result }
  } catch (error) {
    if (claim) {
      try {
        const resolution = await repository.fail(claim)
        if (resolution.status === 'IMPORTED' && resolution.nfId && resolution.numero) {
          return { status: 'IMPORTED', nfId: resolution.nfId, numero: resolution.numero }
        }
        return { status: resolution.status === 'CLEANUP_PENDING' ? 'CLEANUP_PENDING' : 'FAILED' }
      } catch { return { status: 'CLEANUP_PENDING' } }
    }
    if (error instanceof FiscalIntakeError) {
      if (['MISSING_IDENTITY', 'INVALID', 'AMBIGUOUS'].includes(error.code)) {
        return { status: error.code as 'MISSING_IDENTITY' | 'INVALID' | 'AMBIGUOUS' }
      }
      if (error.code === 'DENIED') return { status: 'INVALID' }
    }
    return { status: 'RETRYABLE_ERROR' }
  }
}
