import { describe, it, expect } from 'vitest'
import { activationMissing, emailConfigurationSchema, emailIntegrationSchema, inboxFilterSchema } from './contracts'
import { emailHref, parseEmailInboxFilter } from './navigation'
import { maskEmailSender, safeEmailSubject } from './metadata'

const id = '11111111-1111-4111-8111-111111111111'
const config = { name: 'Documentos fiscais', provider: 'OUTLOOK_GRAPH', environment: 'homologacao', mailbox: null,
  mailboxObjectId: null, folderId: 'inbox', credentialId: null, routingMode: 'ALLOWLIST', cedenteIds: [], startAt: null }
const draft = () => emailIntegrationSchema.parse({ ...config, id, enabled: false, configStatus: 'DRAFT', revision: 1,
  testCompletedAt: null, testErrorCode: null, testRevision: null, healthStatus: 'DISABLED', healthCheckedAt: null, health: null, alerts: [] })

describe('email operator contracts', () => {
  it('saves partial drafts without pretending they are ready for activation', () => {
    expect(emailConfigurationSchema.safeParse(config).success).toBe(true)
    expect(activationMissing(draft())).toHaveLength(5)
  })
  it('requires a recent successful test of the current revision and configured routing', () => {
    const row = { ...draft(), mailbox: 'qa@example.invalid', mailboxObjectId: id, credentialId: id, cedenteIds: [id],
      startAt: '2026-10-01T12:00:00Z', testCompletedAt: '2026-10-01T12:00:00Z', testRevision: 1 }
    expect(activationMissing(row, Date.parse('2026-10-01T12:10:00Z'))).toEqual([])
    expect(activationMissing({ ...row, revision: 2 }, Date.parse('2026-10-01T12:10:00Z'))).toHaveLength(1)
    expect(activationMissing(row, Date.parse('2026-10-01T12:31:00Z'))).toHaveLength(1)
    expect(activationMissing({ ...row, testErrorCode: 'ACCESS_DENIED' }, Date.parse('2026-10-01T12:10:00Z'))).toHaveLength(1)
    expect(activationMissing({ ...row, cedenteIds: [] }, Date.parse('2026-10-01T12:10:00Z'))).toHaveLength(1)
  })
  it('rejects provider, mailbox and pagination tampering', () => {
    expect(emailConfigurationSchema.safeParse({ ...config, provider: 'IMAP' }).success).toBe(false)
    expect(emailConfigurationSchema.safeParse({ ...config, mailbox: 'invalid' }).success).toBe(false)
    expect(inboxFilterSchema.safeParse({ pageSize: 5000 }).success).toBe(false)
    expect(inboxFilterSchema.safeParse({ page: -1 }).success).toBe(false)
    expect(inboxFilterSchema.safeParse({ errorCode: 'Bearer secret' }).success).toBe(false)
  })
  it('keeps filters in navigation and interprets dates in Brasilia', () => {
    const result = parseEmailInboxFilter({ tab: 'review', since: '2026-10-01', until: '2026-10-02', page: '2', pageSize: '50' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toMatchObject({ status: 'REVIEW', page: 2, since: '2026-10-01T00:00:00-03:00', until: '2026-10-02T23:59:59.999-03:00' })
    expect(emailHref('/gestor/integracoes-email', { tab: 'inbox', status: 'ERROR', page: '2' }, { message: id, page: null })).toBe(`/gestor/integracoes-email?tab=inbox&status=ERROR&message=${id}`)
    expect(parseEmailInboxFilter({ since: 'not-a-date' }).success).toBe(false)
    expect(parseEmailInboxFilter({ since: '2026-10-03', until: '2026-10-02' }).success).toBe(false)
  })
})

describe('email display metadata', () => {
  it('masks sender identity and rejects malformed metadata', () => {
    expect(maskEmailSender('financeiro@Example.invalid')).toBe('f***@example.invalid')
    expect(maskEmailSender('secret\n@invalid.test')).toBe('Remetente não disponível')
    expect(maskEmailSender(undefined)).toBe('Remetente não disponível')
  })
  it('removes HTML, controls, links, credentials and direct identifiers from subject', () => {
    const subject = safeEmailSubject('<b>Nota</b>\nsecret=do-not-show pessoa@example.invalid 12.345.678/0001-90 https://example.invalid/?token=secret')
    expect(subject).toContain('Nota'); expect(subject).not.toMatch(/do-not-show|pessoa@|12\.345|https:|<b>|\n/)
    expect(safeEmailSubject('Bearer private-token')).not.toContain('private-token')
    expect(safeEmailSubject('A'.repeat(1000)).length).toBeLessThanOrEqual(240)
    expect(safeEmailSubject('')).toBe('Sem assunto')
  })
})
