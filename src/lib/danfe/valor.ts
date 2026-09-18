import { moneyTokensFromLine, parseDanfeMoney } from './money'

export type DanfeLayout = 'generic_danfe' | 'fiscal_grid_after_labels' | 'canhoto_total'
export type ValorSource =
  | 'VALOR_TOTAL_DA_NOTA'
  | 'VALOR_TOTAL_DA_NOTA_TABELA'
  | 'CANHOTO_VALOR_TOTAL'
  | 'DUPLICATA_SUM'
  | 'VALOR_TOTAL_DOS_PRODUTOS'
  | 'VALOR_ORIGINAL'
  | 'VALOR_LIQUIDO'

export interface ValorCandidate {
  field: 'valor_bruto'
  value: number
  cents: number
  source: ValorSource
  anchor: string
  confidence: number
  rawText: string
  corroboratedBy: ValorSource[]
}

export interface ValorResolution {
  selected?: ValorCandidate
  candidates: ValorCandidate[]
  confidence: number
  conflict: boolean
  reasons: string[]
  strategies: ValorSource[]
  layout: DanfeLayout
}

const MAX_CENTS = 100_000_000_000_000
const CENT_TOLERANCE = 1

function candidate(source: ValorSource, cents: number, anchor: string, rawText: string, confidence: number): ValorCandidate {
  return { field: 'valor_bruto', value: cents / 100, cents, source, anchor, rawText: rawText.slice(0, 80), confidence, corroboratedBy: [] }
}

function directAmount(line: string, label: RegExp): { cents: number; raw: string } | null {
  const match = line.match(label)
  if (!match) return null
  const tail = line.slice((match.index || 0) + match[0].length).trim().replace(/^:\s*/, '')
  const amount = tail.match(/^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[,\.]\d{2})(?![\d.,])/)
  if (!amount) return null
  const parsed = parseDanfeMoney(amount[1])
  return parsed.ok ? { cents: parsed.cents, raw: amount[1] } : null
}

function collectDirect(lines: string[], label: RegExp, source: ValorSource, confidence: number): ValorCandidate[] {
  return lines.flatMap((line, index) => {
    const amount = directAmount(line, label)
    if (amount && amount.cents > 0) return [candidate(source, amount.cents, `line:${index}:label`, amount.raw, confidence)]
    const labelEndsHere = label.test(line)
    const splitLabel = !labelEndsHere && !label.test(lines[index + 1] || '') && label.test(`${line} ${lines[index + 1] || ''}`)
    if (!labelEndsHere && !splitLabel) return []
    const adjacent = lines[index + (splitLabel ? 2 : 1)]?.match(/^\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[,\.]\d{2})\s*$/)
    if (!adjacent) return []
    const parsed = parseDanfeMoney(adjacent[1])
    return parsed.ok && parsed.cents > 0 ? [candidate(source, parsed.cents, `line:${index}:adjacent`, adjacent[1], confidence - 0.02)] : []
  })
}

function collectDuplicatas(lines: string[], numeroNf?: string): ValorCandidate[] {
  const entries = new Map<number, { total: number; cents: number }>()
  for (const line of lines) {
    const match = line.match(/^\s*(\d{1,9})-(\d{1,2})\/(\d{1,2})\s+(\d{2}[-/]\d{2}[-/]\d{4})\s+(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[,\.]\d{2})(?=\s|\||$)/)
    if (!match || (numeroNf && String(Number(match[1])) !== String(Number(numeroNf)))) continue
    const sequence = Number(match[2])
    const total = Number(match[3])
    const parsed = parseDanfeMoney(match[5])
    if (!parsed.ok || parsed.cents <= 0 || total < 1 || total > 120 || sequence < 1 || sequence > total) continue
    const previous = entries.get(sequence)
    if (previous && (previous.cents !== parsed.cents || previous.total !== total)) return []
    entries.set(sequence, { total, cents: parsed.cents })
  }
  if (!entries.size) return []
  const expected = entries.values().next().value?.total
  if (!expected || entries.size !== expected || [...entries.values()].some((entry) => entry.total !== expected)) return []
  const cents = [...entries.values()].reduce((sum, entry) => sum + entry.cents, 0)
  return cents > 0 && cents <= MAX_CENTS ? [candidate('DUPLICATA_SUM', cents, 'duplicata:complete_series', `${entries.size} duplicata(s)`, 0.88)] : []
}

function collectFiscalGrid(lines: string[]): ValorCandidate[] {
  const label = /(?:V\.?|VALOR)\s*TOTAL\s+DA\s+NOTA/i
  const anchors = lines.flatMap((line, index) => label.test(line) || (!label.test(lines[index + 1] || '') && label.test(`${line} ${lines[index + 1] || ''}`)) ? [index] : [])
  const found: ValorCandidate[] = []
  for (const anchor of anchors) {
    // PDF text extraction may emit table labels first and their numeric cells afterwards.
    for (let index = anchor + 1; index < Math.min(lines.length, anchor + 19); index += 1) {
      const line = lines[index].trim()
      if (!/^[\d.,\sR$]+$/.test(line)) continue
      const values = moneyTokensFromLine(line).filter((item) => item.cents > 0 && item.cents <= MAX_CENTS)
      for (const value of values) {
        found.push(candidate(
          'VALOR_TOTAL_DA_NOTA_TABELA', value.cents,
          `line:${anchor}:fiscal_grid:${index}`,
          value.raw,
          values.length === 1 && /^\s*(?:R\$\s*)?\d[\d.,]*\s*$/.test(line) ? 0.62 : 0.55,
        ))
      }
    }
  }
  return found
}

function detectLayout(lines: string[], duplicatas: ValorCandidate[], grid: ValorCandidate[]): DanfeLayout {
  const text = lines.join('\n')
  if (/VALOR\s+TOTAL\s*:\s*R\$/i.test(text)) return 'canhoto_total'
  if (duplicatas.length && grid.length && /FATURA\s*\/\s*DUPLICATA/i.test(text)) return 'fiscal_grid_after_labels'
  return 'generic_danfe'
}

function groupCandidates(candidates: ValorCandidate[]): Array<{ cents: number; score: number; sources: ValorSource[]; items: ValorCandidate[] }> {
  const groups = new Map<number, ValorCandidate[]>()
  for (const item of candidates) groups.set(item.cents, [...(groups.get(item.cents) || []), item])
  return [...groups].map(([cents, items]) => {
    const sources = [...new Set(items.map((item) => item.source))]
    const hasDistinctCorroboration = sources.length > 1
    const gridRepeats = items.filter((item) => item.source === 'VALOR_TOTAL_DA_NOTA_TABELA').length > 1
    const base = Math.max(...items.map((item) => item.confidence))
    return { cents, items, sources, score: Math.min(0.99, base + (hasDistinctCorroboration ? 0.09 : 0) + (gridRepeats ? 0.06 : 0)) }
  }).sort((a, b) => b.score - a.score || b.cents - a.cents)
}

function fiscalFormulaConflict(lines: string[], selectedCents: number): boolean {
  const products = collectDirect(lines, /(?:V\.?|VALOR)\s*TOTAL\s+(?:DOS\s+)?PRODUTOS/i, 'VALOR_TOTAL_DOS_PRODUTOS', 0.61)[0]
  if (!products) return false
  const components: Array<{ label: RegExp; sign: 1 | -1 }> = [
    { label: /VALOR\s+DO\s+FRETE/i, sign: 1 },
    { label: /VALOR\s+DO\s+SEGURO/i, sign: 1 },
    { label: /OUTRAS\s+DESPESAS(?:\s+ACESS[OÓ]RIAS)?/i, sign: 1 },
    { label: /VALOR\s+DO\s+IPI/i, sign: 1 },
    { label: /DESCONTO/i, sign: -1 },
  ]
  let found = 0
  let expected = products.cents
  for (const component of components) {
    const amount = lines.map((line) => directAmount(line, component.label)).find((value) => value !== null)
    if (amount) { expected += component.sign * amount.cents; found += 1 }
    else if (lines.some((line) => component.label.test(line))) return false // Incomplete grid: do not infer zero.
  }
  return found > 0 && Math.abs(expected - selectedCents) > CENT_TOLERANCE
}

/** Structural candidates, then cross-check. No issuer/CNPJ or filename branching. */
export function resolveDanfeValue(text: string, numeroNf?: string): ValorResolution {
  const lines = text.split(/\n/).map((line) => line.trim())
  const direct = collectDirect(lines, /(?:V\.?|VALOR)\s*TOTAL\s+DA\s+NOTA/i, 'VALOR_TOTAL_DA_NOTA', 0.94)
  const canhoto = collectDirect(lines, /VALOR\s+TOTAL\s*:/i, 'CANHOTO_VALOR_TOTAL', 0.93)
  const original = collectDirect(lines, /VALOR\s+ORIGINAL/i, 'VALOR_ORIGINAL', 0.80)
  const liquid = collectDirect(lines, /VALOR\s+L[IÍ]QUIDO/i, 'VALOR_LIQUIDO', 0.78)
  const products = collectDirect(lines, /(?:V\.?|VALOR)\s*TOTAL\s+(?:DOS\s+)?PRODUTOS/i, 'VALOR_TOTAL_DOS_PRODUTOS', 0.61)
  const duplicatas = collectDuplicatas(lines, numeroNf)
  const grid = collectFiscalGrid(lines)
  const candidates = [...direct, ...canhoto, ...duplicatas, ...grid, ...original, ...liquid, ...products]
  const layout = detectLayout(lines, duplicatas, grid)
  const groups = groupCandidates(candidates)
  const winner = groups[0]
  const strong = candidates.filter((item) => ['VALOR_TOTAL_DA_NOTA', 'CANHOTO_VALOR_TOTAL', 'DUPLICATA_SUM'].includes(item.source))
  const strongConflict = strong.some((item) => strong.some((other) => Math.abs(item.cents - other.cents) > CENT_TOLERANCE))
  const repeatedGridConflict = Boolean(duplicatas.length && groups.some((group) => group.cents !== duplicatas[0].cents && group.items.filter((item) => item.source === 'VALOR_TOTAL_DA_NOTA_TABELA').length > 1))
  const unmatchedGridConflict = Boolean(duplicatas.length && grid.length && !grid.some((item) => Math.abs(item.cents - duplicatas[0].cents) <= CENT_TOLERANCE))
  const formulaConflict = winner ? fiscalFormulaConflict(lines, winner.cents) : false
  const conflict = strongConflict || repeatedGridConflict || unmatchedGridConflict || formulaConflict
  const reasons = [
    ...(strongConflict ? ['canonical_duplicate_conflict'] : []),
    ...(repeatedGridConflict || unmatchedGridConflict ? ['fiscal_grid_duplicate_conflict'] : []),
    ...(formulaConflict ? ['fiscal_formula_conflict'] : []),
    ...(!winner ? ['no_money_candidate'] : []),
  ]
  const selected = winner?.items.find((item) => item.source === 'VALOR_TOTAL_DA_NOTA')
    || winner?.items.find((item) => item.source === 'CANHOTO_VALOR_TOTAL')
    || winner?.items.find((item) => item.source === 'VALOR_TOTAL_DA_NOTA_TABELA')
    || winner?.items.find((item) => item.source === 'DUPLICATA_SUM')
    || winner?.items[0]
  if (selected && winner) {
    selected.confidence = conflict ? 0 : winner.score
    selected.corroboratedBy = winner.sources.filter((source) => source !== selected.source)
  }
  return {
    selected,
    candidates,
    confidence: selected?.confidence || 0,
    conflict,
    reasons,
    strategies: [...new Set(candidates.map((item) => item.source))],
    layout,
  }
}
