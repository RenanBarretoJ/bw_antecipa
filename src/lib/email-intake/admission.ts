import { z } from 'zod'
import type { EmailMessage } from './contracts'
import { IntakeError } from './contracts'

const timestamp = z.iso.datetime({ offset: true })
export type KnownEmailMessage = { externalId: string; receivedAt: string }
export type MessageAdmission =
  | { kind: 'ADMIT'; receivedAt: string; existing: boolean }
  | { kind: 'SKIP_BEFORE_START_AT' | 'TOMBSTONE_EXISTING' | 'TOMBSTONE_UNKNOWN' | 'INVALID_TIMESTAMP' }

export function emailTimestamp(value: unknown): number | null {
  if (!timestamp.safeParse(value).success || typeof value !== 'string') return null
  const instant = Date.parse(value)
  return Number.isFinite(instant) ? instant : null
}

/** A remote filter is only an optimization. Known identities come from the leased repository. */
export function evaluateEmailMessageAdmission(message: EmailMessage, startAt: string, known?: KnownEmailMessage): MessageAdmission {
  const boundary = emailTimestamp(startAt)
  if (boundary === null) throw new IntakeError('CONFIGURATION')
  if (known && known.externalId !== message.externalId) throw new IntakeError('CONFIGURATION')
  if (message.removed) return { kind: known ? 'TOMBSTONE_EXISTING' : 'TOMBSTONE_UNKNOWN' }
  // The timestamp at initial admission is immutable; later provider changes cannot rewrite it.
  const receivedAt = known?.receivedAt ?? message.receivedAt
  const received = emailTimestamp(receivedAt)
  if (received === null) return { kind: 'INVALID_TIMESTAMP' }
  if (!known && received < boundary) return { kind: 'SKIP_BEFORE_START_AT' }
  return { kind: 'ADMIT', receivedAt, existing: Boolean(known) }
}
