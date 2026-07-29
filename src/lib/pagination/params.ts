import {
  ALLOWED_PAGE_SIZES,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  type AllowedPageSize,
  type PaginationParams,
  type SearchParamsInput,
} from './types'

const INTEGER_PATTERN = /^\d+$/

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function readSearchParam(
  searchParams: SearchParamsInput,
  name: string,
): string | undefined {
  if (!searchParams) return undefined

  if ('get' in searchParams && typeof searchParams.get === 'function') {
    return searchParams.get(name) ?? undefined
  }

  return firstValue((searchParams as Record<string, string | string[] | undefined>)[name])
}

export function normalizePage(value: unknown, fallback = DEFAULT_PAGE): number {
  const safeFallback = (
    Number.isSafeInteger(fallback)
    && fallback > 0
    && fallback <= MAX_PAGE
  ) ? fallback : DEFAULT_PAGE

  const raw = typeof value === 'number' ? String(value) : firstValue(
    Array.isArray(value) || typeof value === 'string' ? value : undefined,
  )

  if (!raw || !INTEGER_PATTERN.test(raw)) return safeFallback

  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_PAGE
    ? parsed
    : safeFallback
}

export function normalizePageSize(
  value: unknown,
  fallback: AllowedPageSize = DEFAULT_PAGE_SIZE,
): AllowedPageSize {
  const safeFallback = ALLOWED_PAGE_SIZES.includes(fallback)
    ? fallback
    : DEFAULT_PAGE_SIZE

  const raw = typeof value === 'number' ? String(value) : firstValue(
    Array.isArray(value) || typeof value === 'string' ? value : undefined,
  )

  if (!raw || !INTEGER_PATTERN.test(raw)) return safeFallback

  const parsed = Number(raw)
  return ALLOWED_PAGE_SIZES.includes(parsed as AllowedPageSize)
    ? parsed as AllowedPageSize
    : safeFallback
}

export function parsePaginationParams(
  searchParams: SearchParamsInput,
  defaults: Partial<PaginationParams> = {},
): PaginationParams {
  const defaultPage = normalizePage(defaults.page, DEFAULT_PAGE)
  const defaultPageSize = normalizePageSize(defaults.pageSize, DEFAULT_PAGE_SIZE)

  return {
    page: normalizePage(readSearchParam(searchParams, 'page'), defaultPage),
    pageSize: normalizePageSize(
      readSearchParam(searchParams, 'pageSize'),
      defaultPageSize,
    ),
  }
}
