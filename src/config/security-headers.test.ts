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

  it('autoriza o websocket correspondente ao Supabase configurado', async () => {
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321'

    try {
      const rules = await nextConfig.headers!()
      const csp = rules
        .flatMap((rule) => rule.headers)
        .find((header) => header.key.toLowerCase() === 'content-security-policy')
        ?.value

      expect(csp).toContain('connect-src')
      expect(csp).toContain('http://127.0.0.1:55321')
      expect(csp).toContain('ws://127.0.0.1:55321')
    } finally {
      if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
      else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
    }
  })

  it('autoriza preview de imagem somente na origem Supabase configurada', async () => {
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://homolog-example.supabase.co'

    try {
      const rules = await nextConfig.headers!()
      const csp = rules
        .flatMap((rule) => rule.headers)
        .find((header) => header.key.toLowerCase() === 'content-security-policy')
        ?.value
      const imageDirective = csp?.split('; ').find((directive) => directive.startsWith('img-src'))

      expect(imageDirective).toBe("img-src 'self' data: blob: https://homolog-example.supabase.co")
      expect(imageDirective).not.toContain('https://*.supabase.co')
    } finally {
      if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
      else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
    }
  })
})
