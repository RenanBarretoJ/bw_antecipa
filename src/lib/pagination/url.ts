import type {
  SearchParamValue,
  SearchParamsInput,
  SearchParamsLike,
} from './types'

export type ListParamUpdate = string | number | boolean | string[] | null | undefined
export type ListParamUpdates = Record<string, ListParamUpdate>

function appendRecord(params: URLSearchParams, key: string, value: SearchParamValue) {
  const values = Array.isArray(value) ? value : [value]
  for (const item of values) {
    if (item !== undefined) params.append(key, item)
  }
}

function toUrlSearchParams(input: SearchParamsInput): URLSearchParams {
  const params = new URLSearchParams()
  if (!input) return params

  if ('get' in input && typeof input.get === 'function') {
    const compatible = input as SearchParamsLike
    if (typeof compatible.forEach === 'function') {
      compatible.forEach((value, key) => params.append(key, value))
      return params
    }

    return params
  }

  for (const [key, value] of Object.entries(input)) appendRecord(params, key, value)
  return params
}

function applyUpdate(params: URLSearchParams, key: string, value: ListParamUpdate) {
  params.delete(key)

  const values = Array.isArray(value) ? value : [value]
  for (const item of values) {
    if (item === null || item === undefined) continue
    const normalized = String(item).trim()
    if (normalized) params.append(key, normalized)
  }
}

export function buildListParams(
  currentParams: SearchParamsInput,
  updates: ListParamUpdates,
  options: {
    pageParam?: string
    resetPageOn?: readonly string[]
  } = {},
): URLSearchParams {
  const params = toUrlSearchParams(currentParams)
  const pageParam = options.pageParam ?? 'page'
  const resetPageOn = options.resetPageOn ? new Set(options.resetPageOn) : null
  const shouldResetPage = !Object.hasOwn(updates, pageParam)
    && Object.keys(updates).some((key) => (
      resetPageOn ? resetPageOn.has(key) : key !== pageParam
    ))

  for (const [key, value] of Object.entries(updates)) applyUpdate(params, key, value)
  if (shouldResetPage) params.set(pageParam, '1')

  for (const key of [...params.keys()]) {
    if (!params.getAll(key).some((value) => value.trim())) params.delete(key)
  }

  return params
}

export function buildListQuery(
  currentParams: SearchParamsInput,
  updates: ListParamUpdates,
  options?: Parameters<typeof buildListParams>[2],
): string {
  return buildListParams(currentParams, updates, options).toString()
}

export function buildListUrl(
  pathname: string,
  currentParams: SearchParamsInput,
  updates: ListParamUpdates,
  options?: Parameters<typeof buildListParams>[2],
): string {
  const query = buildListQuery(currentParams, updates, options)
  return query ? `${pathname}?${query}` : pathname
}
