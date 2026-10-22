import { describe, expect, it, vi } from 'vitest'
import { CENTRAL_BASES_GESTOR, destinoCentralBases } from './central-bases'

const redirect = vi.hoisted(() => vi.fn((url: string): never => { throw new Error(`REDIRECT:${url}`) }))
vi.mock('next/navigation', () => ({ redirect }))
import Legado from '@/app/gestor/dados-financeiros/page'

describe('endereços canônicos da Central de Bases', () => {
  it('usa nomes iguais ao módulo nos dois portais', () => {
    expect(destinoCentralBases({})).toBe(CENTRAL_BASES_GESTOR)
    expect(destinoCentralBases({}, 'qa')).toBe('/admin/fundos/qa?tab=central-bases')
  })
  it('preserva filtros e paginação, sem transportar IDs ou destinos arbitrários', () => {
    const query = { tab: 'dados-financeiros', pagina: '3', tipo: 'Inclusao', origem: 'MANUAL', estado: 'aceita', referencia: '2026-10-20', fundoId: 'outro', returnTo: 'https://example.org' }
    const url = destinoCentralBases(query, 'qa')
    expect(url).toBe('/admin/fundos/qa?tab=central-bases&pagina=3&tipo=Inclusao&origem=MANUAL&estado=aceita&referencia=2026-10-20')
    expect(url).not.toContain('outro'); expect(url).not.toContain('example.org')
  })
  it('não concatena valores de query nem segmentos como parte do destino', () => {
    expect(destinoCentralBases({ tipo: 'Inclusao&tab=geral', pagina: ['1', '2'] }, 'qa/fora'))
      .toBe('/admin/fundos/qa%2Ffora?tab=central-bases&tipo=Inclusao%26tab%3Dgeral')
  })
  it('o endereço antigo do Gestor redireciona sem executar processamento', async () => {
    await expect(Legado({ searchParams: Promise.resolve({ pagina: '2', origem: 'CRON' }) }))
      .rejects.toThrow('REDIRECT:/gestor/central-bases?pagina=2&origem=CRON')
  })
})
