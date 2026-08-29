import { DEFAULT_SEARCH_MAX_LENGTH } from './types'

export function normalizeSearch(
  value: unknown,
  maxLength = DEFAULT_SEARCH_MAX_LENGTH,
): string {
  if (typeof value !== 'string') return ''

  const safeMaxLength = Number.isSafeInteger(maxLength) && maxLength > 0
    ? maxLength
    : DEFAULT_SEARCH_MAX_LENGTH

  return value.trim().replace(/\s+/g, ' ').slice(0, safeMaxLength)
}

export const normalizarBusca = normalizeSearch
