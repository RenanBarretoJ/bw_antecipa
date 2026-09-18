export type MoneyFormat = 'pt-BR' | 'decimal-comma' | 'decimal-dot'

export type MoneyParseResult =
  | { ok: true; cents: number; value: number; format: MoneyFormat; confidence: number }
  | { ok: false; reason: 'empty' | 'ambiguous' | 'invalid' | 'out_of_range' }

const MAX_CENTS = 100_000_000_000_000

/** Parse only values with an explicit two-digit decimal part. Never guess `1.234`. */
export function parseDanfeMoney(input: string): MoneyParseResult {
  const raw = input.trim().replace(/^R\$\s*/i, '')
  if (!raw) return { ok: false, reason: 'empty' }

  let format: MoneyFormat
  if (/^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(raw)) format = 'pt-BR'
  else if (/^\d+,\d{2}$/.test(raw)) format = 'decimal-comma'
  else if (/^\d+\.\d{2}$/.test(raw)) format = 'decimal-dot'
  else if (/^\d{1,3}[.,]\d{3}$/.test(raw)) return { ok: false, reason: 'ambiguous' }
  else return { ok: false, reason: 'invalid' }

  const digits = raw.replace(/\D/g, '')
  const cents = Number(digits)
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return { ok: false, reason: 'out_of_range' }
  return { ok: true, cents, value: cents / 100, format, confidence: 0.99 }
}

export function moneyTokensFromLine(line: string): Array<{ raw: string; cents: number; value: number; format: MoneyFormat }> {
  const tokens: Array<{ raw: string; cents: number; value: number; format: MoneyFormat }> = []
  const pattern = /\d{1,3}(?:\.\d{3})+,\d{2}(?![\d.,])|\d+,\d{2}(?![\d.,])|\d+\.\d{2}(?![\d.,])/g
  for (const match of line.matchAll(pattern)) {
    const parsed = parseDanfeMoney(match[0])
    if (parsed.ok) tokens.push({ raw: match[0], cents: parsed.cents, value: parsed.value, format: parsed.format })
  }
  return tokens
}
