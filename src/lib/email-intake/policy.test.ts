import { describe, expect, it } from 'vitest'
import { attachmentDisposition, MAX_ATTACHMENT_BYTES, retryDelayMs, routeAttachment, validateAttachmentBytes } from './policy'
import type { EmailAttachment } from './contracts'

const candidate = { cedenteId: 'cedente', cedenteFundoId: 'vinculo', estabelecimentoId: 'matriz',
  fundoId: 'fundo', cnpj: '12345678000190', eligible: true }
const route = { fundoId: 'fundo', issuerCnpj: candidate.cnpj, mode: 'ALL_ACTIVE_CEDENTES' as const,
  allowedCedentes: [], candidates: [candidate] }
const file: EmailAttachment = { externalId: 'a', name: 'nf.pdf', contentType: 'application/pdf', size: 8, inline: false, kind: 'FILE' }

describe('fiscal attachment routing', () => {
  it('routes by issuer inside the integration fund', () => {
    expect(routeAttachment(route)).toEqual({ status: 'ROUTED', candidate })
    expect(routeAttachment({ ...route, fundoId: 'outro' }).status).toBe('UNKNOWN_CEDENTE')
    expect(routeAttachment({ ...route, candidates: [{ ...candidate, eligible: false }] }).status).toBe('UNKNOWN_CEDENTE')
  })
  it('fails closed on ambiguity before applying the allowlist', () => {
    expect(routeAttachment({ ...route, mode: 'ALLOWLIST', allowedCedentes: ['cedente'],
      candidates: [candidate, { ...candidate, cedenteId: 'other', estabelecimentoId: 'other' }] }).status).toBe('AMBIGUOUS_CEDENTE')
  })
  it('requires an explicit allowlist match and does not auto-create an issuer', () => {
    expect(routeAttachment({ ...route, mode: 'ALLOWLIST' }).status).toBe('OUTSIDE_ALLOWLIST')
    expect(routeAttachment({ ...route, issuerCnpj: '' }).status).toBe('UNKNOWN_CEDENTE')
    expect(routeAttachment({ ...route, candidates: [] }).status).toBe('UNKNOWN_CEDENTE')
  })
})

describe('attachment safety', () => {
  it('ignores inline content without downloading it', () => {
    expect(attachmentDisposition({ ...file, inline: true, contentType: 'image/png' })).toBe('IGNORE_INLINE')
  })
  it.each(['nf.pdf.exe', 'nf.zip', 'nf.docx', 'nf.html', 'nf.png'])('rejects %s', name => {
    expect(() => attachmentDisposition({ ...file, name })).toThrow('UNSUPPORTED_FILE')
  })
  it('rejects reference/item attachments and oversized payloads', () => {
    expect(() => attachmentDisposition({ ...file, kind: 'UNSUPPORTED' })).toThrow('UNSUPPORTED_FILE')
    expect(() => attachmentDisposition({ ...file, size: MAX_ATTACHMENT_BYTES + 1 })).toThrow('FILE_TOO_LARGE')
  })
  it('checks magic bytes and declared size', () => {
    expect(validateAttachmentBytes(file, new TextEncoder().encode('%PDF-1.7'))).toBe('PDF')
    expect(() => validateAttachmentBytes(file, new TextEncoder().encode('MZ123456'))).toThrow('UNSUPPORTED_FILE')
    expect(() => validateAttachmentBytes(file, new Uint8Array(9))).toThrow('INVALID_RESPONSE')
  })
  it('rejects XML entity declarations and accepts fiscal XML containers', () => {
    for (const xml of ['<nfeProc><NFe/></nfeProc>', '<?xml version="1.0"?><NFe/>']) {
      const bytes = new TextEncoder().encode(xml)
      expect(validateAttachmentBytes({ ...file, name: 'nf.xml', contentType: 'text/xml', size: bytes.length }, bytes)).toBe('XML')
    }
    const bytes = new TextEncoder().encode('<!DOCTYPE foo><NFe/>')
    expect(() => validateAttachmentBytes({ ...file, name: 'nf.xml', contentType: 'text/xml', size: bytes.length }, bytes)).toThrow('UNSUPPORTED_FILE')
  })
  it('never retries earlier than Retry-After', () => {
    expect(retryDelayMs(1, 60_000, () => 0)).toBe(60_000)
    expect(retryDelayMs(3, 0, () => 1)).toBe(4000)
  })
})
