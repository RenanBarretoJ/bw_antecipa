import { describe, expect, it } from 'vitest'
import { buildDescendingCreatedAtCursorFilter } from './keyset'
import { encodeCursor, parseCursor } from './cursor'

describe('compound created_at cursor', () => {
  it('builds the OR predicate matching the descending stable order', () => {
    const payload = {
      createdAt: '2026-07-30T10:00:00.123456Z',
      id: '00000000-0000-4000-8000-000000000200',
    }

    expect(buildDescendingCreatedAtCursorFilter(payload)).toBe(
      'created_at.lt.2026-07-30T10:00:00.123456Z,and(created_at.eq.2026-07-30T10:00:00.123456Z,id.lt.00000000-0000-4000-8000-000000000200)',
    )
  })

  it('preserves microseconds after canonical cursor parsing', () => {
    const parsed = parseCursor(encodeCursor({
      createdAt: '2026-07-30T10:00:00.123456Z',
      id: '00000000-0000-4000-8000-000000000200',
    }))

    expect(parsed?.createdAt).toBe('2026-07-30T10:00:00.123456Z')
  })

  it('rejects invalid timestamps and ids', () => {
    expect(parseCursor('invalid')).toBeNull()
    expect(() => encodeCursor({
      createdAt: 'not-a-date',
      id: 'not-a-uuid',
    })).toThrow('CursorPayload')
  })

  it('does not omit rows sharing the cursor timestamp', () => {
    const rows = [
      { createdAt: '2026-07-30T10:00:00.000000Z', id: '00000000-0000-4000-8000-000000000300' },
      { createdAt: '2026-07-30T10:00:00.000000Z', id: '00000000-0000-4000-8000-000000000200' },
      { createdAt: '2026-07-30T10:00:00.000000Z', id: '00000000-0000-4000-8000-000000000100' },
      { createdAt: '2026-07-30T09:59:59.999999Z', id: '00000000-0000-4000-8000-000000000900' },
    ]
    const cursor = rows[1]
    const pageTwo = rows.filter((row) => (
      row.createdAt < cursor.createdAt
      || (row.createdAt === cursor.createdAt && row.id < cursor.id)
    ))

    expect(pageTwo).toEqual([rows[2], rows[3]])
  })

  it('keeps the next page stable when the cursor row is removed between requests', () => {
    const cursor = {
      createdAt: '2026-07-30T10:00:00.000000Z',
      id: '00000000-0000-4000-8000-000000000200',
    }
    const remainingRows = [
      { createdAt: cursor.createdAt, id: '00000000-0000-4000-8000-000000000300' },
      { createdAt: cursor.createdAt, id: '00000000-0000-4000-8000-000000000100' },
      { createdAt: '2026-07-30T09:59:59.999999Z', id: '00000000-0000-4000-8000-000000000900' },
    ]

    expect(remainingRows.filter((row) => (
      row.createdAt < cursor.createdAt
      || (row.createdAt === cursor.createdAt && row.id < cursor.id)
    ))).toEqual(remainingRows.slice(1))
  })

  it('does not duplicate a new item inserted above the cursor', () => {
    const cursor = {
      createdAt: '2026-07-30T10:00:00.000000Z',
      id: '00000000-0000-4000-8000-000000000200',
    }
    const rowsAfterInsert = [
      { createdAt: '2026-07-30T10:01:00.000000Z', id: '00000000-0000-4000-8000-000000000400' },
      { createdAt: cursor.createdAt, id: '00000000-0000-4000-8000-000000000300' },
      { createdAt: cursor.createdAt, id: '00000000-0000-4000-8000-000000000100' },
      { createdAt: '2026-07-30T09:59:59.999999Z', id: '00000000-0000-4000-8000-000000000900' },
    ]

    expect(rowsAfterInsert.filter((row) => (
      row.createdAt < cursor.createdAt
      || (row.createdAt === cursor.createdAt && row.id < cursor.id)
    ))).toEqual(rowsAfterInsert.slice(2))
  })
})
