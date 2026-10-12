import { describe, expect, it } from 'vitest'
import { evaluateEmailMessageAdmission } from './admission'

const start = '2026-10-01T16:33:55.572Z'
const message = (receivedAt: string, removed = false) => ({ externalId: 'mail', receivedAt, removed, hasAttachments: true })
describe('initial message admission', () => {
  it.each([
    ['2026-10-01T16:33:55.571Z', 'SKIP_BEFORE_START_AT'],
    [start, 'ADMIT'], ['2026-10-01T16:33:55.573Z', 'ADMIT'],
    ['2026-10-01T13:33:55.572-03:00', 'ADMIT'],
    ['2026-10-01T18:33:55.571+02:00', 'SKIP_BEFORE_START_AT'],
    ['', 'INVALID_TIMESTAMP'], ['not-a-date', 'INVALID_TIMESTAMP'],
    ['2026-10-01T16:33:55', 'INVALID_TIMESTAMP'], ['2026-02-30T00:00:00Z', 'INVALID_TIMESTAMP'],
  ])('compares %s as an instant: %s', (received, kind) => {
    expect(evaluateEmailMessageAdmission(message(received), start).kind).toBe(kind)
  })
  it('rejects invalid integration configuration', () => {
    expect(() => evaluateEmailMessageAdmission(message(start), 'invalid')).toThrow('CONFIGURATION')
  })
  it('preserves the original timestamp of a legitimately admitted identity', () => {
    const known = { externalId: 'mail', receivedAt: '2026-09-30T00:00:00Z' }
    expect(evaluateEmailMessageAdmission(message(''), start, known)).toEqual({ kind: 'ADMIT', existing: true, receivedAt: known.receivedAt })
  })
  it('does not require timestamps for known or unknown tombstones', () => {
    expect(evaluateEmailMessageAdmission(message('', true), start).kind).toBe('TOMBSTONE_UNKNOWN')
    expect(evaluateEmailMessageAdmission(message('', true), start, { externalId: 'mail', receivedAt: start }).kind).toBe('TOMBSTONE_EXISTING')
  })
})
