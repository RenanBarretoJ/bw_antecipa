import { normalizePage, normalizePageSize } from './params'
import type {
  OffsetRange,
  PaginatedResult,
  PaginationMeta,
  PaginationParams,
} from './types'

export function buildOffsetRange(params: PaginationParams): OffsetRange {
  const page = normalizePage(params.page)
  const pageSize = normalizePageSize(params.pageSize)
  const from = (page - 1) * pageSize

  return {
    from,
    to: from + pageSize - 1,
  }
}

export function buildPaginationMeta(input: PaginationParams & {
  total: number
  currentItemCount: number
}): PaginationMeta {
  const requestedPage = normalizePage(input.page)
  const pageSize = normalizePageSize(input.pageSize)
  const total = Number.isSafeInteger(input.total) && input.total > 0 ? input.total : 0
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages)
  const currentItemCount = (
    Number.isSafeInteger(input.currentItemCount)
    && input.currentItemCount > 0
  ) ? Math.min(input.currentItemCount, pageSize) : 0
  const from = currentItemCount === 0 ? 0 : ((page - 1) * pageSize) + 1
  const to = currentItemCount === 0
    ? 0
    : Math.min(from + currentItemCount - 1, total)

  return {
    page,
    pageSize,
    total,
    totalPages,
    hasPrevious: page > 1,
    hasNext: totalPages > 0 && page < totalPages,
    from,
    to,
    requestedPage,
    wasPageAdjusted: page !== requestedPage,
  }
}

export function buildPaginatedResult<T>(
  items: T[],
  input: PaginationParams & { total: number },
): PaginatedResult<T> {
  return {
    items,
    pagination: buildPaginationMeta({
      ...input,
      currentItemCount: items.length,
    }),
  }
}
