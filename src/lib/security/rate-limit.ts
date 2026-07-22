import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { registrarEventoSeguranca } from '@/lib/auth/mfa'

export type RateLimitEscopo =
  | 'login'
  | 'mfa_totp'
  | 'mfa_recovery'
  | 'portal_fidc_test'
  | 'portal_fidc_send'
  | 'critical_action'

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  blockedUntil: string | null
}

export function rateLimitKey(escopo: RateLimitEscopo, identifier: string) {
  return createHash('sha256').update(`${escopo}:${identifier.toLowerCase().trim()}`).digest('hex')
}

export async function verificarRateLimit({
  escopo,
  identifier,
  limite = 5,
  janelaMs = 15 * 60 * 1000,
  bloqueioMs = 15 * 60 * 1000,
}: {
  escopo: RateLimitEscopo
  identifier: string
  limite?: number
  janelaMs?: number
  bloqueioMs?: number
}): Promise<RateLimitResult> {
  const admin = createAdminClient()
  const keyHash = rateLimitKey(escopo, identifier)
  const now = new Date()

  const { data } = await admin
    .from('seguranca_rate_limits')
    .select('*')
    .eq('key_hash', keyHash)
    .maybeSingle()

  const row = data as { tentativas: number; primeira_tentativa_em: string; bloqueado_ate: string | null } | null

  if (row?.bloqueado_ate && new Date(row.bloqueado_ate).getTime() > now.getTime()) {
    return { allowed: false, remaining: 0, blockedUntil: row.bloqueado_ate }
  }

  const dentroDaJanela = row ? now.getTime() - new Date(row.primeira_tentativa_em).getTime() <= janelaMs : false
  const tentativas = dentroDaJanela && row ? row.tentativas : 0

  if (tentativas >= limite) {
    const blockedUntil = new Date(now.getTime() + bloqueioMs).toISOString()
    await admin.from('seguranca_rate_limits').upsert({
      key_hash: keyHash,
      escopo,
      tentativas,
      bloqueado_ate: blockedUntil,
      primeira_tentativa_em: row?.primeira_tentativa_em || now.toISOString(),
      ultima_tentativa_em: now.toISOString(),
      updated_at: now.toISOString(),
    } as never)
    await registrarEventoSeguranca({ tipo_evento: 'RATE_LIMIT_BLOQUEADO', ator_tipo: 'sistema', origem: escopo, severidade: 'warning', dados: { escopo } })
    return { allowed: false, remaining: 0, blockedUntil }
  }

  return { allowed: true, remaining: Math.max(0, limite - tentativas), blockedUntil: null }
}

export async function registrarTentativaRateLimit({
  escopo,
  identifier,
  sucesso,
}: {
  escopo: RateLimitEscopo
  identifier: string
  sucesso: boolean
}) {
  const admin = createAdminClient()
  const keyHash = rateLimitKey(escopo, identifier)
  const now = new Date().toISOString()

  if (sucesso) {
    await admin.from('seguranca_rate_limits').delete().eq('key_hash', keyHash)
    return
  }

  const { data } = await admin
    .from('seguranca_rate_limits')
    .select('tentativas, primeira_tentativa_em')
    .eq('key_hash', keyHash)
    .maybeSingle()

  const row = data as { tentativas: number; primeira_tentativa_em: string } | null

  await admin.from('seguranca_rate_limits').upsert({
    key_hash: keyHash,
    escopo,
    tentativas: (row?.tentativas || 0) + 1,
    primeira_tentativa_em: row?.primeira_tentativa_em || now,
    ultima_tentativa_em: now,
    updated_at: now,
  } as never)
}
