import { parseDanfeMoney } from './money'

type FaturaEntry = { sequence: number; due: string; cents: number }
export type DanfeFatura = { entries: FaturaEntry[]; cents: number; due?: string; reasons: string[] }

/** Strict calendar conversion shared by the textual DANFE extractors. */
export function parseDanfeDate(raw: string): string | undefined {
  const [d, m, y] = raw.split(/[-/]/)
  const day = Number(d), month = Number(m), year = Number(y)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (year < 1900 || year > 2200 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return undefined
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** Only the numbered `Val:` format inside FATURA. Other legacy layouts stay with their own extractors. */
export function extractDanfeFatura(text: string): DanfeFatura | undefined {
  const sections = [...text.matchAll(/(?:^|\n)[ \t]*FATURA(?:[ \t]*\/[ \t]*DUPLICATA)?[ \t]*:?[ \t]*\n([\s\S]*?)(?=\n[ \t]*(?:C[ÁA]LCULO\s+DO\s+IMPOSTO|TRANSPORTADOR|DADOS\s+D[OA]S?\s+PRODUTOS|INFORMA[ÇC][ÕO]ES|DADOS\s+ADICIONAIS)\b|$)/gi)]
  const blocks = sections.map(match => match[1]).filter(block => /\bVal\s*:/i.test(block))
  if (!blocks.length) return undefined
  const invalid = (): DanfeFatura => ({ entries: [], cents: 0, reasons: ['fatura_structure_conflict'] })
  // Repeated pages/sections cannot silently double the payable amount.
  if (blocks.length !== 1 || blocks[0].length > 4096) return invalid()
  const block = blocks[0]
  const pattern = /(?:^|\n)[ \t]*(\d{1,3})\s*[-–]\s*(\d{2}[-/]\d{2}[-/]\d{4})\s*[-–]\s*Val\s*:\s*((?:R\$\s*)?\d[\d.,]*)[ \t]*(?=\n|$)/gi
  const matches = [...block.matchAll(pattern)]
  if (!matches.length || matches.length > 120 || block.replace(pattern, '').trim()) return invalid()
  const entries: FaturaEntry[] = []
  for (const [index, match] of matches.entries()) {
    const due = parseDanfeDate(match[2])
    const amount = parseDanfeMoney(match[3])
    if (Number(match[1]) !== index + 1 || !due || !amount.ok || amount.cents <= 0) return invalid()
    entries.push({ sequence: index + 1, due, cents: amount.cents })
  }
  const cents = entries.reduce((sum, entry) => sum + entry.cents, 0)
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_000_000) return invalid()
  return { entries, cents, due: entries.map(entry => entry.due).sort().at(-1), reasons: [] }
}
