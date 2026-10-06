import { describe, expect, it } from 'vitest'
import { attachmentFeedback, emailDateLabel, emailErrorMessage } from './presentation'

describe('Email Intake operator feedback', () => {
  it('does not expose unknown provider payloads as operator errors', () => {
    const raw = 'Bearer qa-sensitive-token; https://provider.invalid?secret=private'
    expect(emailErrorMessage(raw)).not.toContain(raw)
    expect(attachmentFeedback(raw, raw).description).not.toContain(raw)
  })
  it('distinguishes unknown senders from excluded cedentes using persisted outcome codes', () => {
    expect(attachmentFeedback('QUARANTINED', 'UNKNOWN_CEDENTE').label).toBe('Cedente não identificado')
    expect(attachmentFeedback('QUARANTINED', 'ROUTING_DENIED').label).toBe('Cedente não autorizado')
  })
  it('preserves success even when an earlier error code is present', () => {
    expect(attachmentFeedback('IMPORTED', 'INVALID').tone).toBe('success')
    expect(attachmentFeedback('DUPLICATE', 'UNKNOWN_CEDENTE').label).toBe('Duplicado')
  })
  it('provides a next step while a document waits for human review or cleanup', () => {
    expect(attachmentFeedback('REQUIRES_REVIEW', null).description).toContain('Vencimento')
    expect(attachmentFeedback('CLEANUP_PENDING', null).description).toContain('Aguarde')
  })
  it('does not access inherited object keys for untrusted status or error codes', () => {
    expect(attachmentFeedback('__proto__', null).label).toBe('Estado não reconhecido')
    expect(typeof emailErrorMessage('constructor')).toBe('string')
  })
  it('renders the operational timezone consistently and handles missing or invalid timestamps', () => {
    expect(emailDateLabel('2026-10-01T20:00:00Z')).toContain('17:00')
    expect(emailDateLabel(null)).toBe('Ainda não registrado')
    expect(emailDateLabel('invalid timestamp')).toBe('Ainda não registrado')
  })
})
