import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260803172546_mfa_sessao_24h.sql'), 'utf8')
const ambiguityFixMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260804093210_corrigir_ambiguidade_registrar_sessao_mfa.sql'),
  'utf8',
)
const sensitiveAction = readFileSync(join(process.cwd(), 'src/lib/auth/sensitive-action.ts'), 'utf8')
const provider = readFileSync(join(process.cwd(), 'src/components/auth/mfa-session-provider.tsx'), 'utf8')
const mfaActions = readFileSync(join(process.cwd(), 'src/app/actions/mfa.ts'), 'utf8')

describe('MFA session architecture', () => {
  it('binds elevation to the exact Supabase session and invalidates legacy rows', () => {
    expect(migration).toContain('delete from public.sessoes_elevadas')
    expect(migration).toContain('primary key (user_id, session_id)')
    expect(migration).toContain("auth.jwt() ->> 'session_id'")
    expect(migration).toContain('from auth.sessions s')
    expect(migration).toContain("v_agora + interval '24 hours'")
  })

  it('uses the named primary key as an unambiguous MFA session conflict target', () => {
    expect(ambiguityFixMigration).toContain('on conflict on constraint sessoes_elevadas_pkey')
    expect(ambiguityFixMigration).not.toContain('on conflict (user_id, session_id)')
  })

  it('preserves a fixed window and rejects the exact expiry boundary server-side', () => {
    expect(migration).toContain('v_agora >= v_elevacao.expira_em')
    expect(migration).not.toMatch(/expira_em\s*=\s*clock_timestamp\(\)\s*\+\s*interval '24 hours'/)
  })

  it('consumes a sensitive authorization atomically for action and session', () => {
    expect(migration).toContain('create or replace function public.consumir_autorizacao_acao_sensivel')
    expect(migration).toContain('and a.session_id = v_session_id')
    expect(migration).toContain('and a.action_type = p_action_type')
    expect(migration).toContain('and a.consumida_em is null')
    expect(migration).toContain('set consumida_em = clock_timestamp()')
    expect(migration).toContain('and clock_timestamp() < a.expira_em')
  })

  it('keeps integration credential operations in distinct authorization scopes', () => {
    expect(migration).toContain("'cadastrar_credencial_integracao'")
    expect(migration).toContain("'rotacionar_credencial_integracao'")
    expect(migration).toContain("'ativar_credencial_integracao'")
    expect(migration).toContain("'revogar_credencial_integracao'")
  })

  it('requires fresh Supabase TOTP without persisting the code or raw nonce', () => {
    expect(sensitiveAction).toContain('mfa.challenge')
    expect(sensitiveAction).toContain('mfa.verify')
    expect(sensitiveAction).toContain("currentLevel !== 'aal2'")
    expect(sensitiveAction).toContain('p_nonce_hash: nonceHash')
    expect(sensitiveAction).not.toContain('dados: { code')
    expect(sensitiveAction).not.toContain('dados: { nonce')
  })

  it('coordinates expiry across tabs and revalidates after suspension', () => {
    expect(provider).toContain('BroadcastChannel')
    expect(provider).toContain("window.addEventListener('storage'")
    expect(provider).toContain("window.addEventListener('focus'")
    expect(provider).toContain("document.addEventListener('visibilitychange'")
    expect(provider).toContain("method: 'POST'")
  })

  it('allows factor discovery before TOTP without relaxing the post-challenge gate', () => {
    const listarFatores = mfaActions.match(/export async function listarFatoresMfa[\s\S]*?\n}\n\nfunction normalizarNextAposMfa/)?.[0] || ''
    const redirecionar = mfaActions.match(/export async function redirecionarAposMfa[\s\S]*$/)?.[0] || ''

    expect(listarFatores).toContain('allowMfaPending: true')
    expect(redirecionar).toContain('requireAuthenticated()')
    expect(redirecionar).not.toContain('allowMfaPending')
  })
})
