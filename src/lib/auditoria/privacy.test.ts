import { describe, expect, it } from 'vitest'
import { mascararIp, sanitizarDetalheAuditoria } from './privacy'

describe('audit privacy', () => {
  it('redacts secrets recursively', () => {
    expect(sanitizarDetalheAuditoria({
      status: 'ok',
      credentials: { password: 'secret' },
      authorization: 'Bearer token',
    })).toEqual({
      status: 'ok',
      credentials: '[redigido]',
      authorization: '[redigido]',
    })
  })

  it('masks IPv4 and IPv6 addresses', () => {
    expect(mascararIp('192.168.1.20')).toBe('192.168.x.x')
    expect(mascararIp('2001:db8:abcd:0012::1')).toBe('2001:db8:abcd:…')
  })
})
