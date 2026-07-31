import { describe, expect, it } from 'vitest'
import { buildDescendingCreatedAtCursorFilter } from './keyset'
import { decodeCursor, encodeCursor } from './cursor'

describe('cursor keyset', () => {
  it('preserva microssegundos e UUID PostgreSQL sem bits RFC', () => {
    const payload = {
      createdAt: '2026-07-30T14:06:28.900008+00:00',
      id: 'ebd828cc-ee15-3d89-096b-00a6ea2ccfb3',
    }

    const encoded = encodeCursor(payload)

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(encoded)).toEqual({
      createdAt: '2026-07-30T14:06:28.900008Z',
      id: payload.id,
    })
  })

  it('rejeita payload e base64url malformados sem lancar no decode', () => {
    expect(decodeCursor('%%%')).toBeNull()
    expect(decodeCursor('eyJjcmVhdGVkQXQiOiJpbnZhbGlkbyIsImlkIjoieCJ9')).toBeNull()
  })

  it('gera filtro deterministico por created_at e id', () => {
    expect(buildDescendingCreatedAtCursorFilter({
      createdAt: '2026-07-30T14:06:28.900008Z',
      id: 'ebd828cc-ee15-3d89-096b-00a6ea2ccfb3',
    })).toBe([
      'created_at.lt.2026-07-30T14:06:28.900008Z',
      'and(created_at.eq.2026-07-30T14:06:28.900008Z,id.lt.ebd828cc-ee15-3d89-096b-00a6ea2ccfb3)',
    ].join(','))
  })
})
