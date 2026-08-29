const SENSITIVE_KEY = /(authorization|cookie|password|senha|token|secret|segredo|credential|credencial|otp|nonce|private.?key|service.?role)/i

export function mascararIp(ip: unknown): string | null {
  if (typeof ip !== 'string' || !ip.trim()) return null
  const value = ip.trim()
  if (value.includes(':')) {
    const segments = value.split(':')
    return `${segments.slice(0, 3).join(':')}:…`
  }
  const segments = value.split('.')
  return segments.length === 4 ? `${segments[0]}.${segments[1]}.x.x` : 'mascarado'
}
export function sanitizarDetalheAuditoria(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[conteudo omitido]'
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizarDetalheAuditoria(item, depth + 1))
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 2_000) return `${value.slice(0, 2_000)}…`
    return value
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[redigido]' : sanitizarDetalheAuditoria(entry, depth + 1),
    ]),
  )
}
