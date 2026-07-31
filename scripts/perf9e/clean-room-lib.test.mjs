import { describe, expect, it } from 'vitest'
import {
  assertCleanRoomArguments,
  configureDisposableToml,
  sanitizedLocalEnvironment,
  stableCatalogRows,
} from './clean-room-lib.mjs'

describe('Escopo 9E clean-room safety', () => {
  it('exige confirmacao local explicita', () => {
    expect(() => assertCleanRoomArguments({})).toThrow(/DISPOSABLE_LOCAL_ONLY/)
  })

  it.each(['db-url', 'env-file', 'linked', 'remote', 'prod', 'production', 'homolog', 'project-ref'])(
    'recusa argumento remoto %s',
    (argument) => expect(() => assertCleanRoomArguments({ confirm: 'DISPOSABLE_LOCAL_ONLY', [argument]: true })).toThrow(/recusa/),
  )

  it('remove credenciais e marcadores de ambiente herdados', () => {
    const sanitized = sanitizedLocalEnvironment({ PATH: 'ok', DATABASE_URL: 'secret', APP_ENV: 'homolog', SUPABASE_SERVICE_ROLE_KEY: 'secret' })
    expect(sanitized.PATH).toBe('ok')
    expect(sanitized.DATABASE_URL).toBeUndefined()
    expect(sanitized.APP_ENV).toBeUndefined()
    expect(sanitized.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
  })

  it('isola portas e desabilita seed', () => {
    const source = `[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n[studio]\nport = 54323\n[inbucket]\nport = 54324\n[db.seed]\nenabled = true\nsql_paths = ["./seed.sql"]\n[analytics]\nport = 54327\nproject_id = "old"`
    const result = configureDisposableToml(source, { projectId: 'local', apiPort: 1, dbPort: 2, shadowPort: 3, studioPort: 4, mailPort: 5, analyticsPort: 6 })
    expect(result).toContain('enabled = false')
    expect(result).toContain('sql_paths = []')
    expect(result).toContain('port = 2')
  })

  it('normaliza e ordena catalogo de forma deterministica', () => {
    expect(stableCatalogRows([{ b: 'x  y', a: 2 }, { a: 1 }])).toEqual([{ a: 1 }, { a: 2, b: 'x y' }])
  })
})
