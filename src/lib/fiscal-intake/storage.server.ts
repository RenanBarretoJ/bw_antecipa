import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { FiscalIntakeError } from './contracts'
import type { FiscalStorage } from './service.server'

/** Paths are issued by the fenced journal; storage.objects enforces late-write fencing. */
export function createFiscalStorage(): FiscalStorage {
  return {
    async upload(intent, file) {
      const { error } = await createAdminClient().storage.from(intent.bucket).upload(intent.path, Buffer.from(await file.arrayBuffer()), {
        contentType: intent.path.endsWith('.xml') ? 'application/xml' : 'application/pdf', upsert: false,
      })
      if (error) throw new FiscalIntakeError('INFRASTRUCTURE')
    },
  }
}

const cleanupSchema = z.object({ id: z.string().uuid(), token: z.string().uuid(),
  bucket: z.enum(['notas-fiscais', 'documentos-v2']), path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) })

/** Bounded reconciliation; uncertain deletes stay durable and keep the identity. */
export async function processFiscalCleanup(limit = 10, reservationId?: string) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new FiscalIntakeError('INVALID')
  const admin = createAdminClient()
  const { error: expiryError } = await admin.rpc('fiscal_intake_reconcile_expired', { p_limit: limit })
  if (expiryError) throw new FiscalIntakeError('INFRASTRUCTURE')
  const result = { removed: 0, pending: 0 }
  for (let index = 0; index < limit; index++) {
    const { data, error } = await admin.rpc('fiscal_intake_claim_cleanup', { p_reservation_id: reservationId })
    if (error) throw new FiscalIntakeError('INFRASTRUCTURE')
    if (data === null) break
    const claim = cleanupSchema.parse(data)
    const { error: removeError } = await admin.storage.from(claim.bucket).remove([claim.path])
    const { error: settleError } = await admin.rpc('fiscal_intake_settle_cleanup', {
      p_id: claim.id, p_token: claim.token, p_deleted: !removeError,
    })
    if (removeError || settleError) result.pending++
    else result.removed++
  }
  return result
}
