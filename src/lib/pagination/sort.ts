import type { SortDirection, StableSort } from './types'

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function parseSortParams<const TField extends string>(input: {
  sort: string | string[] | undefined
  direction: string | string[] | undefined
  allowedFields: readonly TField[]
  defaultField: TField
  defaultDirection?: SortDirection
}): StableSort<TField> {
  const rawSort = firstValue(input.sort)
  const rawDirection = firstValue(input.direction)
  const defaultDirection = input.defaultDirection ?? 'desc'
  const field = rawSort && input.allowedFields.includes(rawSort as TField)
    ? rawSort as TField
    : input.defaultField
  const direction = rawDirection === 'asc' || rawDirection === 'desc'
    ? rawDirection
    : defaultDirection

  return {
    field,
    direction,
    tieBreaker: 'id',
  }
}
