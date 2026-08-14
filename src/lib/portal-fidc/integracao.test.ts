import { describe, expect, it, vi } from 'vitest'
import { mapearStatusPortalFidc, sha256Hex } from '@/lib/portal-fidc/integracao'

vi.mock('server-only', () => ({}))

describe('Portal FIDC integration helpers', () => {
  it('nao mantem fallback de credencial por ambiente', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./integracao.ts', import.meta.url), 'utf8'))
    expect(source).not.toContain('PORTAL_FIDC_CREDENTIAL_')
    expect(source).not.toContain("source: 'env_fallback'")
    expect(source).toContain('credencial_integracao_id')
  })

  it('mapeia estados externos conhecidos e preserva desconhecidos como pendentes', () => {
    expect(mapearStatusPortalFidc('Arquivo processado com sucesso')).toMatchObject({ statusInterno: 'aceita', pendente: false })
    expect(mapearStatusPortalFidc('Remessa rejeitada pelo administrador')).toMatchObject({ statusInterno: 'rejeitada', pendente: false })
    expect(mapearStatusPortalFidc('Em processamento')).toMatchObject({ statusInterno: 'enviada', pendente: true })
    expect(mapearStatusPortalFidc('Status XYZ nao catalogado')).toMatchObject({ statusInterno: 'enviada', pendente: true, statusExterno: 'Status XYZ nao catalogado' })
  })

  it('gera hash sha256 deterministico para idempotencia e auditoria', () => {
    expect(sha256Hex('portal-fidc')).toBe(sha256Hex('portal-fidc'))
    expect(sha256Hex('portal-fidc')).toHaveLength(64)
  })
})
