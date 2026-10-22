import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { CARTEIRA_VORTX_AGENDA, carteiraProcessamentoPermitido, planejarRotinaCarteiraVortx } from './carteira-rotina'
const fund = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const env = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', NEXT_PUBLIC_SUPABASE_URL: 'https://wwsndnuvnjuabpbjwlck.supabase.co', INTEGRATION_RUNTIME_ENV: 'producao', VORTX_REPORTS_PRODUCTION_ENABLED: 'true', VORTX_REPORTS_PRODUCTION_FUNDO_ID: fund, VORTX_CARTEIRA_PROCESSING_ENABLED: 'true' }
afterEach(() => vi.unstubAllEnvs())
describe('carteira Vortx D-1 util, 17h de Brasilia', () => {
  it.each([
    ['2026-10-22T20:00:00Z', '2026-10-21'], ['2026-10-19T20:00:00Z', '2026-10-16'],
    ['2026-10-13T20:00:00Z', '2026-10-09'], ['2026-01-02T20:00:00Z', '2025-12-31'],
  ])('usa D-1 util, nao D-2, em %s', (instant, reference) => {
    expect(planejarRotinaCarteiraVortx(new Date(instant))).toMatchObject({ executar: true, dataReferencia: reference })
  })
  it.each(['2026-10-22T12:30:00Z', '2026-10-22T19:59:59Z', '2026-10-22T03:00:00Z'])('nao consulta antes das 17h em %s', instant => {
    expect(planejarRotinaCarteiraVortx(new Date(instant))).toMatchObject({ executar: false, motivo: 'AGUARDANDO_17H' })
  })
  it('02h UTC ainda pertence ao dia anterior em Brasilia, apos as 17h locais', () => {
    expect(planejarRotinaCarteiraVortx(new Date('2026-10-22T02:00:00Z'))).toMatchObject({ executar: true, dataOperacional: '2026-10-21', dataReferencia: '2026-10-20' })
  })
  it.each(['2026-10-17', '2026-10-18', '2026-10-12', '2026-12-25'])('ignora fim de semana/feriado %s', day => {
    expect(planejarRotinaCarteiraVortx(new Date(`${day}T20:00:00Z`))).toMatchObject({ executar: false, motivo: 'DIA_NAO_UTIL_ANBIMA' })
  })
  it('agenda separada, sem mover estoque ou demais providers', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
    expect(CARTEIRA_VORTX_AGENDA.cronUtc).toBe('0 20 * * 1-5')
    expect(config.crons).toContainEqual({ path: '/api/cron/vortx-carteira', schedule: '0 20 * * 1-5' })
    expect(config.crons).toContainEqual({ path: '/api/cron/vortx-relatorios', schedule: '30 12 * * 1-5' })
    expect(config.crons).toContainEqual({ path: '/api/cron/financeiro', schedule: '30 12 * * 1-5' })
  })
  it('exige habilitacao explicita, ambiente e Fundo', () => {
    expect(carteiraProcessamentoPermitido(fund, env)).toBe(true)
    expect(carteiraProcessamentoPermitido(fund, { ...env, VORTX_CARTEIRA_PROCESSING_ENABLED: 'false' })).toBe(false)
    expect(carteiraProcessamentoPermitido('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', env)).toBe(false)
    expect(carteiraProcessamentoPermitido(fund, { ...env, INTEGRATION_RUNTIME_ENV: 'homologacao' })).toBe(false)
    expect(carteiraProcessamentoPermitido(fund, { ...env, VERCEL_GIT_COMMIT_REF: 'other' })).toBe(false)
  })
})
