import type { CursorPayload } from './types'

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
// PostgreSQL aceita UUIDs com qualquer combinacao de bits de versao/variante.
// O cursor valida o formato do tipo uuid, sem impor UUID RFC gerado pela app.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/

function isValidCalendarDate(date: string, time: string, timezone: string): boolean {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute, second] = time.split(':').map(Number)
  const calendar = new Date(0)
  calendar.setUTCHours(0, 0, 0, 0)
  calendar.setUTCFullYear(year, month - 1, day)

  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || calendar.getUTCFullYear() !== year
    || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day
    || hour > 23
    || minute > 59
    || second > 59
  ) return false

  if (timezone === 'Z') return true
  const [offsetHour, offsetMinute] = timezone.slice(1).split(':').map(Number)
  return (
    offsetHour < 14
    || (offsetHour === 14 && offsetMinute === 0)
  ) && offsetMinute <= 59
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array | null {
  if (!value || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return null

  try {
    const standard = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=')
    const binary = atob(padded)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

function normalizeCursorDate(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) return null

  const [, date, time, fraction = '', timezone] = match
  if (!isValidCalendarDate(date, time, timezone)) return null

  const milliseconds = fraction.slice(0, 3).padEnd(3, '0')
  const parsed = new Date(`${date}T${time}.${milliseconds}${timezone}`)
  if (Number.isNaN(parsed.getTime())) return null

  const canonicalPrefix = parsed.toISOString().slice(0, 19)
  const microseconds = fraction.slice(0, 6).padEnd(6, '0')

  const canonical = `${canonicalPrefix}.${microseconds}Z`
  const canonicalDate = new Date(canonical)
  return Number.isNaN(canonicalDate.getTime()) ? null : canonical
}

function normalizeCursorId(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null
}

function parsePayload(value: unknown): CursorPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const entries = Object.entries(value)
  if (
    entries.length !== 2
    || !Object.hasOwn(value, 'createdAt')
    || !Object.hasOwn(value, 'id')
  ) return null

  const payload = value as Record<string, unknown>
  const createdAt = normalizeCursorDate(payload.createdAt)
  const id = normalizeCursorId(payload.id)
  return createdAt && id ? { createdAt, id } : null
}

export function encodeCursor(payload: CursorPayload): string {
  const normalized = parsePayload(payload)
  if (!normalized) throw new TypeError('CursorPayload inválido.')

  const bytes = new TextEncoder().encode(JSON.stringify(normalized))
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export function decodeCursor(cursor: unknown): CursorPayload | null {
  if (typeof cursor !== 'string') return null

  const bytes = base64ToBytes(cursor)
  if (!bytes) return null

  try {
    return parsePayload(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

export const parseCursor = decodeCursor
