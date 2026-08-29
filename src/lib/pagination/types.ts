export const ALLOWED_PAGE_SIZES = [10, 20, 40] as const

export const DEFAULT_PAGE = 1
export const DEFAULT_PAGE_SIZE = 10
export const MAX_PAGE = 1_000_000
export const DEFAULT_SEARCH_MAX_LENGTH = 120

export type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number]
export type SortDirection = 'asc' | 'desc'

export interface PaginationParams {
  page: number
  pageSize: AllowedPageSize
}

export interface OffsetRange {
  from: number
  to: number
}

export interface PaginationMeta extends PaginationParams {
  total: number
  totalPages: number
  hasPrevious: boolean
  hasNext: boolean
  from: number
  to: number
  requestedPage: number
  wasPageAdjusted: boolean
}

export interface PaginatedResult<T> {
  items: T[]
  pagination: PaginationMeta
}

export interface CursorPayload {
  createdAt: string
  id: string
}

export interface CursorResult<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

export interface StableSort<TField extends string = string> {
  field: TField
  direction: SortDirection
  tieBreaker: 'id'
}

export type SearchParamValue = string | string[] | undefined
export type SearchParamsRecord = Record<string, SearchParamValue>

export interface SearchParamsLike {
  get(name: string): string | null
  getAll?(name: string): string[]
  forEach?(
    callback: (value: string, key: string, parent: SearchParamsLike) => void,
  ): void
}

export type SearchParamsInput = SearchParamsLike | SearchParamsRecord | null | undefined
