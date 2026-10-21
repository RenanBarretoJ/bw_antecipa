import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import nextConfig from '../../../next.config'

describe('Chromium assets for the document functions', () => {
  it('includes the installed binaries only in document generation routes', () => {
    expect(nextConfig.outputFileTracingIncludes).toEqual({
      '/api/contratos/gerar-contrato': ['./node_modules/@sparticuz/chromium/bin/**/*'],
      '/api/contratos/gerar-termo': ['./node_modules/@sparticuz/chromium/bin/**/*'],
      '/api/contratos/gerar-notificacao': ['./node_modules/@sparticuz/chromium/bin/**/*'],
      '/api/contratos/gerar-quitacao': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    })
  })

  it.each(['gerar-contrato', 'gerar-termo', 'gerar-notificacao', 'gerar-quitacao'])(
    'covers %s without changing its authorization boundary', (route) => {
      const source = readFileSync(resolve('src/app/api/contratos', route, 'route.ts'), 'utf8')
      expect(nextConfig.outputFileTracingIncludes).toHaveProperty(`/api/contratos/${route}`)
      expect(source).toContain('@/lib/pdf/gerarContrato')
      expect(source).toContain('await requireGestor()')
    },
  )
})
