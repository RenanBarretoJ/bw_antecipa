import type { EmailAttachment, RoutingMode } from './contracts'
import { IntakeError } from './contracts'

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_LEASE_MS = 15 * 60 * 1000
export type RouteCandidate = {
  cedenteId: string
  cedenteFundoId: string
  estabelecimentoId: string
  fundoId: string
  cnpj: string
  eligible: boolean
}
export type RoutingResult =
  | { status: 'ROUTED'; candidate: RouteCandidate }
  | { status: 'UNKNOWN_CEDENTE' | 'AMBIGUOUS_CEDENTE' | 'OUTSIDE_ALLOWLIST' }

/** Candidates must come from the official establishment eligibility gate. */
export function routeAttachment(input: {
  fundoId: string; issuerCnpj: string; mode: RoutingMode
  allowedCedentes: readonly string[]; candidates: readonly RouteCandidate[]
}): RoutingResult {
  const cnpj = input.issuerCnpj.replace(/\D/g, '')
  if (cnpj.length !== 14) return { status: 'UNKNOWN_CEDENTE' }
  const matches = input.candidates.filter(candidate => candidate.eligible
    && candidate.fundoId === input.fundoId && candidate.cnpj.replace(/\D/g, '') === cnpj)
  const unique = new Map(matches.map(candidate => [candidate.estabelecimentoId, candidate]))
  if (unique.size === 0) return { status: 'UNKNOWN_CEDENTE' }
  if (unique.size > 1) return { status: 'AMBIGUOUS_CEDENTE' }
  const candidate = [...unique.values()][0]
  if (input.mode === 'ALLOWLIST' && !input.allowedCedentes.includes(candidate.cedenteId)) {
    return { status: 'OUTSIDE_ALLOWLIST' }
  }
  return { status: 'ROUTED', candidate }
}

export function attachmentDisposition(attachment: EmailAttachment): 'DOWNLOAD' | 'IGNORE_INLINE' {
  if (attachment.inline) return 'IGNORE_INLINE'
  if (attachment.kind !== 'FILE') throw new IntakeError('UNSUPPORTED_FILE')
  if (!Number.isSafeInteger(attachment.size) || attachment.size <= 0 || attachment.size > MAX_ATTACHMENT_BYTES) {
    throw new IntakeError('FILE_TOO_LARGE')
  }
  const extension = attachment.name.split('.').pop()?.toLowerCase()
  const mime = attachment.contentType.split(';')[0].trim().toLowerCase()
  if (!(extension === 'pdf' && ['application/pdf', 'application/octet-stream'].includes(mime))
    && !(extension === 'xml' && ['application/xml', 'text/xml', 'application/octet-stream'].includes(mime))) {
    throw new IntakeError('UNSUPPORTED_FILE')
  }
  return 'DOWNLOAD'
}

/** This identifies the container only. Fiscal parsing stays in the official importer. */
export function validateAttachmentBytes(attachment: EmailAttachment, bytes: Uint8Array): 'PDF' | 'XML' {
  if (attachmentDisposition(attachment) !== 'DOWNLOAD') throw new IntakeError('UNSUPPORTED_FILE')
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new IntakeError('FILE_TOO_LARGE')
  if (bytes.length !== attachment.size) throw new IntakeError('INVALID_RESPONSE', true)
  const prefix = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 4096)).replace(/^\uFEFF/, '').trimStart()
  if (attachment.name.toLowerCase().endsWith('.pdf') && prefix.startsWith('%PDF-')) return 'PDF'
  if (attachment.name.toLowerCase().endsWith('.xml')
    && /^(?:<\?xml\s[^?]*\?>\s*)?<(?!html\b|script\b)[A-Za-z_][\w.:-]*(?:\s|\/?>)/i.test(prefix)
    && !/<!DOCTYPE|<!ENTITY/i.test(new TextDecoder().decode(bytes))) return 'XML'
  throw new IntakeError('UNSUPPORTED_FILE')
}

export function retryDelayMs(attempt: number, retryAfterMs = 0, random = Math.random): number {
  const exponent = Math.min(10, Math.max(0, Math.floor(attempt) - 1))
  const jitter = Math.max(0, Math.min(1, random()))
  return Math.max(retryAfterMs, Math.min(15 * 60_000, 1000 * 2 ** exponent) * (0.5 + jitter / 2))
}
