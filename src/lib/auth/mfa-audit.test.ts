import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registrarEventoSeguranca } from './mfa'

const { insert, from, createAdminClient } = vi.hoisted(() => {
  const insert = vi.fn()
  const from = vi.fn(() => ({ insert }))
  return { insert, from, createAdminClient: vi.fn(() => ({ from })) }
})
vi.mock('@/lib/supabase/server', () => ({ createAdminClient, createClient: vi.fn() }))

const safeMessage = 'Nao foi possivel registrar o evento de seguranca.'
const originalMigration = readFileSync('supabase/migrations/20260722132525_fase9_mfa_totp_hardening.sql', 'utf8')
const tableDefinition = originalMigration.match(/CREATE TABLE IF NOT EXISTS public\.seguranca_eventos \(([\s\S]*?)\n\);/)![1]
const canonicalColumns = [...tableDefinition.matchAll(/^  (\w+) (?:uuid|text|jsonb|timestamptz)\b/gm)].map((match) => match[1])

describe('security audit persistence contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insert.mockResolvedValue({ error: null })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it.each(['MFA_LOGIN_VALIDADO', 'MFA_ACAO_SENSIVEL_VALIDADA', 'AUTORIZACAO_SENSIVEL_CONSUMIDA', 'SESSOES_REVOGADAS'] as const)(
    'persists %s using only canonical columns', async (tipo_evento) => {
      await registrarEventoSeguranca({ tipo_evento })
      const payload = insert.mock.calls[0][0]
      expect(from).toHaveBeenCalledWith('seguranca_eventos')
      expect(canonicalColumns).toHaveLength(13)
      expect(Object.keys(payload).filter((key) => !canonicalColumns.includes(key))).toEqual([])
      expect(payload).not.toHaveProperty('correlation_id')
      expect(payload).toMatchObject({ tipo_evento, ator_tipo: 'usuario', origem: 'app', severidade: 'info', dados: {} })
      expect(insert).toHaveBeenCalledTimes(1)
      expect(console.error).not.toHaveBeenCalled()
    },
  )

  it('preserves actor/context and correlation metadata without mutating the caller', async () => {
    const dados = Object.freeze({ action_type: 'encerrar_outras_sessoes', session_id: 'synthetic-session', correlation_id: 'nested' })
    await registrarEventoSeguranca({
      tipo_evento: 'SESSOES_REVOGADAS', usuario_id: 'user', ator_usuario_id: 'actor', ator_tipo: 'sistema',
      origem: 'password_flow', severidade: 'warning', entidade_tipo: 'profile', entidade_id: 'entity',
      ip_hash: 'ip-hash', user_agent_hash: 'ua-hash', correlation_id: 'request-correlation', dados,
    })
    expect(insert).toHaveBeenCalledWith({
      tipo_evento: 'SESSOES_REVOGADAS', usuario_id: 'user', ator_usuario_id: 'actor', ator_tipo: 'sistema',
      origem: 'password_flow', severidade: 'warning', entidade_tipo: 'profile', entidade_id: 'entity',
      ip_hash: 'ip-hash', user_agent_hash: 'ua-hash',
      dados: { ...dados, correlation_id: 'request-correlation' },
    })
    expect(dados.correlation_id).toBe('nested')
  })

  it('does not erase existing metadata when optional correlation is null', async () => {
    await registrarEventoSeguranca({ tipo_evento: 'MFA_LOGIN_VALIDADO', correlation_id: null, dados: { correlation_id: 'existing' } })
    expect(insert.mock.calls[0][0].dados).toEqual({ correlation_id: 'existing' })
  })

  it.each(['PGRST204', '23514', '42501', '23503'])(
    'rejects returned database error %s without leaking details or retrying', async (code) => {
      insert.mockResolvedValueOnce({ error: { code, message: 'SECRET SQL', details: 'TOKEN', hint: 'PRIVATE' } })
      await expect(registrarEventoSeguranca({ tipo_evento: 'MFA_LOGIN_VALIDADO', dados: { private: 'NEVER_LOG' } })).rejects.toThrow(safeMessage)
      expect(console.error).toHaveBeenCalledExactlyOnceWith('[auth][SECURITY_AUDIT_WRITE_FAILED]', { databaseCode: code })
      expect(insert).toHaveBeenCalledTimes(1)
    },
  )

  it('sanitizes transport exceptions and untrusted error codes', async () => {
    insert.mockRejectedValueOnce(Object.assign(new Error('secret endpoint/token'), { code: 'Bearer PRIVATE' }))
    await expect(registrarEventoSeguranca({ tipo_evento: 'MFA_LOGIN_VALIDADO' })).rejects.toThrow(safeMessage)
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[auth][SECURITY_AUDIT_WRITE_FAILED]', { databaseCode: null })
  })

  it('sanitizes client initialization failures', async () => {
    createAdminClient.mockImplementationOnce(() => { throw new Error('private configuration') })
    await expect(registrarEventoSeguranca({ tipo_evento: 'MFA_LOGIN_VALIDADO' })).rejects.toThrow(safeMessage)
    expect(insert).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[auth][SECURITY_AUDIT_WRITE_FAILED]', { databaseCode: null })
  })
})
