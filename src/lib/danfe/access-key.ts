export function validNfeKey(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false
  if (key.slice(20, 22) !== '55' || !/^(?:1[1-7]|2[1-9]|3[1-3]|35|4[1-3]|5[0-3])$/.test(key.slice(0, 2))) return false
  if (Number(key.slice(4, 6)) < 1 || Number(key.slice(4, 6)) > 12) return false
  let sum = 0
  let weight = 2
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(key[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const remainder = sum % 11
  return Number(key[43]) === (remainder < 2 ? 0 : 11 - remainder)
}

type PrintedIdentity = { numero?: string; serie?: string; issuer?: string; issued?: string }

/** A reference is informational only when explicitly labeled and independently
 * disambiguated by the printed fiscal header. Unknown second keys stay blocked. */
export function resolveDanfeAccessKey(text: string, printed: PrintedIdentity): {
  key?: string; invalid: boolean; ambiguous: boolean
} {
  const matches = [...text.matchAll(/(?<!\d)(?:\d{4}[ .]+){10}\d{4}(?!\d)|(?<!\d)\d{44}(?!\d)/g)]
  const candidates = matches.map(match => {
    const start = match.index
    const prefix = text.slice(Math.max(0, start - 180), start)
    const reference = /\bNF-?e\s+REF(?:ERENCIADA)?\.?\s*:\s*$/i.test(prefix)
    const anchor = [...prefix.matchAll(/CHAVE\s+DE\s+ACESSO/gi)].at(-1)
    const afterAnchor = anchor ? prefix.slice(anchor.index + anchor[0].length) : ''
    const primary = Boolean(anchor && !reference && !/DESTINAT[ÁA]RIO|FATURA|INFORMA[ÇC][ÕO]ES|DADOS\s+ADICIONAIS|NF-?e\s+REF/i.test(afterAnchor))
    return { key: match[0].replace(/\D/g, ''), reference, primary }
  })
  const primary = [...new Set(candidates.filter(item => item.primary).map(item => item.key))]
  const all = [...new Set(candidates.map(item => item.key))]
  const selected = primary.length === 1 ? primary[0] : candidates.find(item => !item.reference)?.key
  const valid = selected !== undefined && validNfeKey(selected)
  const corroborated = valid && printed.numero !== undefined && printed.serie !== undefined
    && Number(printed.numero) === Number(selected.slice(25, 34))
    && Number(printed.serie) === Number(selected.slice(22, 25))
    && printed.issuer === selected.slice(6, 20)
    && printed.issued?.slice(2, 7).replace('-', '') === selected.slice(2, 6)
  const resolvedReferences = primary.length === 1 && corroborated
    && candidates.every(item => item.key === selected || item.reference)
  return {
    key: valid ? selected : undefined,
    invalid: selected !== undefined && !valid,
    ambiguous: primary.length > 1 || (all.length > 1 && !resolvedReferences),
  }
}
