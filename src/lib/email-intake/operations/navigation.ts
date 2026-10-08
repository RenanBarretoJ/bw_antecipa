import { inboxFilterSchema } from './contracts'

export type EmailSearchParams = Record<string, string | string[] | undefined>
export const firstEmailParam = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value
export function emailHref(base: string, params: EmailSearchParams, changes: Record<string, string | null>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) { const first = firstEmailParam(value); if (first) query.set(key, first) }
  for (const [key, value] of Object.entries(changes)) { if (value === null) query.delete(key); else query.set(key, value) }
  return `${base}?${query}`
}
export function parseEmailInboxFilter(params: EmailSearchParams) {
  const get = (key: string) => firstEmailParam(params[key]) || undefined
  const since = get('since'), until = get('until')
  return inboxFilterSchema.safeParse({ page: get('page'), pageSize: get('pageSize'), status: get('tab') === 'review' ? 'REVIEW' : get('status'),
    reviewOnly: get('tab') === 'review',
    integrationId: get('filterIntegration'), cedenteId: get('cedenteId'), errorCode: get('errorCode'), documentType: get('documentType'),
    since: since ? `${since}T00:00:00-03:00` : undefined, until: until ? `${until}T23:59:59.999-03:00` : undefined })
}
