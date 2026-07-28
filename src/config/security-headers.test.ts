import { describe, expect, it } from 'vitest'
import nextConfig from '../../next.config'

describe('security headers', () => {
  it('permite preview seguro de PDF via iframe blob', async () => {
    expect(typeof nextConfig.headers).toBe('function')

    const rules = await nextConfig.headers!()
    const csp = rules
      .flatMap((rule) => rule.headers)
      .find((header) => header.key.toLowerCase() === 'content-security-policy')
      ?.value

    expect(csp).toContain("frame-src 'self' blob: data:")
    expect(csp).toContain("frame-ancestors 'none'")
  })
})
