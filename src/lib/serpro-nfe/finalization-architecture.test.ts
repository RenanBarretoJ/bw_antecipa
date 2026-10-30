import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SERPRO_RECOVERY_LIMITS } from './recovery.server'
const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
const draft = JSON.parse(readFileSync('scripts/qa/serpro/finalization-draft.json', 'utf8'))
describe('local finalization is not authority to enable the live integration', () => {
  it('declares exactly one protected recovery cron and retains the six existing schedules', () => {
    expect(config.crons.filter((cron: { path: string }) => cron.path === '/api/cron/serpro-nfe')).toEqual([{ path: '/api/cron/serpro-nfe', schedule: '* * * * *' }])
    expect(config.crons.filter((cron: { path: string }) => cron.path !== '/api/cron/serpro-nfe')).toEqual([
      { path: '/api/cron/vortx-carteira', schedule: '0 20 * * 1-5' },
      { path: '/api/cron/vortx-relatorios', schedule: '30 12 * * 1-5' },
      { path: '/api/cron/financeiro', schedule: '30 12 * * 1-5' },
      { path: '/api/cron/vencimentos', schedule: '0 8 * * *' },
      { path: '/api/cron/documentos-vencidos', schedule: '30 8 * * *' },
      { path: '/api/cron/comunicacoes', schedule: '0 11 * * *' },
    ])
    expect(config.git.deploymentEnabled['feature/s1-serpro-nfe-gestor-20261026']).toBe(false)
  })
  it('keeps every remote GO false and binds draft limits without executing configuration', () => {
    expect(draft.status).toBe('DRAFT_NOT_EXECUTABLE')
    expect(Object.values(draft.authority).every(value => value === false)).toBe(true)
    expect(draft.recovery).toMatchObject(SERPRO_RECOVERY_LIMITS)
    expect(draft.recovery.verifiedPlanRequired).toBe(true)
    expect(draft.scope).toMatchObject({ documentModel: 'NFE_55', funds: 'ALL', automaticLegacyBackfill: false })
    expect(draft.realSmoke).toMatchObject({ plannedTestGets: 2, globalGetCeiling: null, ordinaryAuthorizedTrafficIncluded: true })
    expect(draft.activationExecutorCertified).toBe(false)
  })
  it('does not evolve the immediate hint into a loop or install a provider call in the UI', () => {
    const dispatch = readFileSync('src/lib/serpro-nfe/dispatch.server.ts', 'utf8')
    expect(dispatch).toContain('runSerproNfeWorkerOnce()')
    expect(dispatch).not.toContain('runSerproNfeRecoveryBatch')
    expect(readFileSync('src/app/api/cron/serpro-nfe/route.ts', 'utf8')).toContain('timingSafeEqual')
  })
})
