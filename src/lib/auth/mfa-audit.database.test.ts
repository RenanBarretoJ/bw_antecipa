import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { registrarEventoSeguranca } from './mfa'

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: () => ({ insert }) }), createClient: vi.fn(),
}))

// Opt-in real SQL contract test, not an Auth/RLS certification. Never reads remote env files.
// The writer is the same service_role used by createAdminClient, with canonical table grants.
describe.runIf(process.env.BW_AUTH_AUDIT_DOCKER_TEST === '1')('audit contract in a fresh disposable PostgreSQL', () => {
  const name = `bw-auth-audit-${randomUUID()}`
  const password = randomUUID()
  const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  let ownedContainerId: string | undefined
  let admin: Client | undefined
  let writer: Client | undefined
  const actor = '11111111-1111-4111-8111-111111111111'

  beforeAll(async () => {
    ownedContainerId = docker('run', '-d', '--pull', 'never', '--name', name, '--label', `bw.auth-audit=${name}`,
      '--tmpfs', '/var/lib/postgresql/data', '-p', '127.0.0.1::5432',
      '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:17-alpine')
    for (let attempt = 0; attempt < 60; attempt++) {
      try { docker('exec', ownedContainerId, 'pg_isready', '-U', 'postgres'); break } catch {
        if (attempt === 59) throw new Error('Disposable PostgreSQL did not become ready')
        await delay(500)
      }
    }
    const port = Number(docker('port', ownedContainerId, '5432/tcp').split(':').at(-1))
    expect(Number.isInteger(port) && port > 0).toBe(true)
    const config = { host: '127.0.0.1', port, database: 'postgres', password, connectionTimeoutMillis: 5000 }
    admin = new Client({ ...config, user: 'postgres' })
    await admin.connect()
    const original = readFileSync('supabase/migrations/20260722132525_fase9_mfa_totp_hardening.sql', 'utf8')
    const mfa = readFileSync('supabase/migrations/20260803172546_mfa_sessao_24h.sql', 'utf8')
    const table = original.match(/CREATE TABLE IF NOT EXISTS public\.seguranca_eventos \([\s\S]*?\n\);/)?.[0]
    const constraint = mfa.match(/alter table public\.seguranca_eventos\s+drop constraint[\s\S]*?\]\)\);/)?.[0]
    expect(table).toBeTruthy()
    expect(constraint).toBeTruthy()
    await admin.query(`CREATE ROLE service_role LOGIN BYPASSRLS PASSWORD '${password}'; CREATE TABLE public.profiles (id uuid PRIMARY KEY);`)
    await admin.query(table!)
    await admin.query(constraint!)
    await admin.query('ALTER TABLE public.seguranca_eventos ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA public TO service_role; GRANT ALL ON public.seguranca_eventos TO service_role;')
    await admin.query('INSERT INTO public.profiles(id) VALUES ($1)', [actor])
    writer = new Client({ ...config, user: 'service_role' })
    await writer.connect()
    insert.mockImplementation(async (payload: Record<string, unknown>) => {
      const keys = Object.keys(payload)
      if (!keys.every((key) => /^[a-z_]+$/.test(key))) throw new Error('Invalid fixture column')
      try {
        await writer!.query(`INSERT INTO public.seguranca_eventos (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(payload))
        return { error: null }
      } catch (error) { return { error } }
    })
  }, 60000)

  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    try { await Promise.all([writer?.end(), admin?.end()]) } finally {
      if (ownedContainerId) {
        const label = docker('inspect', '--format', '{{index .Config.Labels "bw.auth-audit"}}', ownedContainerId)
        if (label !== name) throw new Error('Refusing cleanup: disposable container ownership mismatch')
        docker('rm', '-f', '-v', ownedContainerId)
      }
    }
  }, 15000)

  it('rejects the old top-level column with no row inserted', async () => {
    const result = await insert({ tipo_evento: 'MFA_LOGIN_VALIDADO', correlation_id: null, dados: {} })
    expect(result.error?.code).toBe('42703')
    expect((await admin!.query('SELECT count(*)::int n FROM public.seguranca_eventos')).rows[0].n).toBe(0)
  })

  it.each(['MFA_LOGIN_VALIDADO', 'MFA_ACAO_SENSIVEL_VALIDADA', 'AUTORIZACAO_SENSIVEL_CONSUMIDA', 'SESSOES_REVOGADAS'] as const)(
    'persists and reads back %s with the actual application helper', async (tipo_evento) => {
      await registrarEventoSeguranca({ tipo_evento, usuario_id: actor, ator_usuario_id: actor,
        correlation_id: `qa-${tipo_evento}`, dados: { action_type: 'encerrar_outras_sessoes' } })
      const { rows } = await admin!.query('SELECT usuario_id, ator_usuario_id, dados FROM public.seguranca_eventos WHERE tipo_evento=$1', [tipo_evento])
      expect(rows).toEqual([{ usuario_id: actor, ator_usuario_id: actor,
        dados: { correlation_id: `qa-${tipo_evento}`, action_type: 'encerrar_outras_sessoes' } }])
    },
  )

  it('surfaces a real foreign-key failure safely and does not fabricate an event', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(registrarEventoSeguranca({ tipo_evento: 'MFA_LOGIN_VALIDADO', usuario_id: randomUUID() }))
      .rejects.toThrow('Nao foi possivel registrar o evento de seguranca.')
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[auth][SECURITY_AUDIT_WRITE_FAILED]', { databaseCode: '23503' })
    expect((await admin!.query('SELECT count(*)::int n FROM public.seguranca_eventos')).rows[0].n).toBe(4)
  })
})
