import { afterEach, describe, expect, it } from 'vitest'
import { assertHomologEnvironment, loadHomologEnv } from './helpers.mjs'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
})

function configureLocal() {
  process.env.BW_CLEAN_ROOM_E2E = '1'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-service-role-placeholder'
  process.env.SUPABASE_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  process.env.NODE_ENV = 'test'
}

describe('RLX Golden clean-room guard', () => {
  it('aceita somente endpoints locais quando explicitamente habilitado', () => {
    configureLocal()
    expect(loadHomologEnv()).toMatchObject({ cleanRoom: true, path: null })
    expect(assertHomologEnvironment({ 'expected-project-ref': 'bw-antecipa-p265-clean-room' })).toMatchObject({
      appEnv: 'clean-room', cleanRoom: true, projectRef: 'bw-antecipa-p265-clean-room',
    })
  })

  it('bloqueia API remota mesmo no modo clean-room', () => {
    configureLocal()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    expect(() => assertHomologEnvironment({ 'expected-project-ref': 'bw-antecipa-p265-clean-room' }))
      .toThrow(/localhost/)
  })
})
