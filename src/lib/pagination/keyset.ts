import type { CursorPayload } from './types'

/**
 * PostgREST expression equivalent to:
 * created_at < cursor.createdAt OR
 * (created_at = cursor.createdAt AND id < cursor.id).
 *
 * Callers must obtain the payload through parseCursor() before using it here.
 */
export function buildDescendingCreatedAtCursorFilter(cursor: CursorPayload): string {
  return [
    `created_at.lt.${cursor.createdAt}`,
    `and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
  ].join(',')
}
